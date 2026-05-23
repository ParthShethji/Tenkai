// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  AgentFiCreditScore
 * @notice On-chain reputation and credit scoring for AgentFi autonomous lending agents.
 *
 * Design principles encoded here:
 *  1. Volume-weighted rep deltas  — micro-loan grinding earns fractional credit.
 *  2. Loan step cap               — max loan = min(rep-based cap, 3× largest repaid).
 *  3. Uncollateralised ramp       — separate clean-count gate before zero-collateral access.
 *  4. Anomaly gate                — 5× avg loan jump triggers manual review flag.
 *  5. Rep escrow                  — active large uncollat loan blocks new borrow orders.
 *  6. Inactivity decay            — −0.5 per 30 days after 60 days dormant.
 *  7. Sibling bootstrap           — volume-weighted cross-user bonus, capped at rep 33.
 *  8. ZK vouching                 — one-time +8, non-repeatable.
 *
 * All scores are stored as integers scaled by PRECISION (1e4) to avoid floats.
 * Public getters return human-readable values via helper functions.
 */
contract AgentFiCreditScore {

    // ─────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────

    uint256 public constant PRECISION          = 1e4;   // 4 decimal places

    // Score bounds (scaled)
    uint256 public constant SCORE_MIN          = 0;
    uint256 public constant SCORE_MAX          = 50  * PRECISION;   // 50.0000
    uint256 public constant SCORE_NEW_AGENT    = 25  * PRECISION;   // 25.0000
    uint256 public constant SCORE_COLLAT_CROSS = 35  * PRECISION;   // 35.0000 → 0% collateral
    uint256 public constant SCORE_SIBLING_CAP  = 33  * PRECISION;   // 33.0000 → sibling bootstrap ceiling

    // Collateral curve:  collateral% = max(0, (35 − rep) × 2.86)
    // Represented as basis points: 2.86% = 286 bps per rep unit
    uint256 public constant COLLAT_SLOPE_BPS   = 286;               // bps per rep unit below crossover

    // Loan sizing
    uint256 public constant MAX_LOAN_PER_REP   = 20 * PRECISION;    // rep × 20 USDC (scaled)
    uint256 public constant LOAN_STEP_MULT     = 3  * PRECISION;    // 3× max repaid
    uint256 public constant FIRST_LOAN_HARD_CAP = 100 * PRECISION;  // 100 USDC first ever loan

    // Anomaly detection — flag if new request > 5× trailing avg
    uint256 public constant ANOMALY_JUMP_MULT  = 5  * PRECISION;

    // Uncollateralised ramp caps (USDC, scaled by PRECISION)
    // Index = uncollat_clean_count; value = USDC cap (0 = unlimited)
    uint256[6] private UNCOLLAT_RAMP = [
        50  * PRECISION,   // 0 clean uncollat loans → max 50 USDC
        150 * PRECISION,   // 1
        350 * PRECISION,   // 2
        600 * PRECISION,   // 3
        800 * PRECISION,   // 4
        0                  // 5+ → unlimited (rep-based cap only)
    ];

    // Rep escrow threshold — lock rep during active uncollat loan above this
    uint256 public constant ESCROW_THRESHOLD   = 300 * PRECISION;   // 300 USDC

    // Rep deltas (scaled, signed via int256 in functions)
    int256 public constant DELTA_REPAY_PROFIT  =  2 * int256(PRECISION);
    int256 public constant DELTA_REPAY_NOALPHA =  1 * int256(PRECISION);
    int256 public constant DELTA_LATE          = -2 * int256(PRECISION);
    int256 public constant DELTA_PARTIAL       = -4 * int256(PRECISION);
    int256 public constant DELTA_DEFAULT       = -10* int256(PRECISION);
    int256 public constant DELTA_ZK_VOUCH      =  8 * int256(PRECISION);
    int256 public constant DELTA_INACTIVITY    = -5000;              // −0.5 per 30d (5000 = 0.5×PRECISION)

    // Inactivity decay triggers after 60 days
    uint256 public constant INACTIVITY_WINDOW  = 60 days;
    uint256 public constant DECAY_PERIOD       = 30 days;

    // Interest floor: max(0.5%, 3.5% − rep × 0.06%) in bps
    uint256 public constant INTEREST_BASE_BPS  = 350;   // 3.5%
    uint256 public constant INTEREST_FLOOR_BPS = 50;    // 0.5%
    uint256 public constant INTEREST_SLOPE     = 6;     // 0.06% per rep unit (in bps)

    // ─────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────

    address public owner;
    mapping(address => bool) public authorisedReporters; // matcher / settlement service

    modifier onlyOwner()    { require(msg.sender == owner, "NOT_OWNER"); _; }
    modifier onlyReporter() { require(authorisedReporters[msg.sender], "NOT_REPORTER"); _; }

    // ─────────────────────────────────────────────
    // Data Structures
    // ─────────────────────────────────────────────

    struct Agent {
        bytes32  agentId;          // UUID as bytes32
        bytes32  userId;           // owner's userId — used for anti-self-match
        uint256  score;            // current rep score (scaled ×PRECISION)
        bool     zkVouchUsed;      // one-time ZK vouching flag
        bool     repEscrowed;      // true = blocked from new borrow orders
        uint256  activeLoanId;     // 0 = no active loan
        uint256  lastActivityTs;   // last loan/repay timestamp
        uint256  largestRepaid;    // largest single loan amount fully repaid (scaled)
        uint256  uncollCleanCount; // # of uncollateralised loans repaid on time
        bool     registered;
    }

    struct LoanRecord {
        uint256  loanId;
        bytes32  borrowerAgentId;
        bytes32  lenderAgentId;
        uint256  amount;           // USDC (scaled ×PRECISION)
        uint256  openedAt;
        uint256  dueAt;
        uint256  closedAt;         // 0 = still open
        uint256  repaidAmount;     // actual repaid
        bool     wasCollateralised;
        bool     anomalyFlagged;   // true = caught by 5× jump gate
        LoanStatus status;
    }

    enum LoanStatus { Open, RepaidProfit, RepaidNoAlpha, Late, Partial, Defaulted }

    struct RepEvent {
        uint256  timestamp;
        int256   delta;            // scaled
        uint256  newScore;         // scaled
        bytes32  source;           // "REPAY_PROFIT", "DEFAULT", "ZK_VOUCH", "DECAY", etc.
        uint256  loanId;           // 0 if not loan-related
    }

    // ─────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────

    mapping(bytes32 => Agent)       public agents;
    mapping(uint256 => LoanRecord)  public loans;
    mapping(bytes32 => uint256[])   public agentLoanIds;    // agentId → loan IDs
    mapping(bytes32 => RepEvent[])  public repHistory;      // agentId → event log
    mapping(bytes32 => uint256[])   private _loanAmounts;   // for avg calculation (last 10)

    uint256 private _loanCounter;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event AgentRegistered  (bytes32 indexed agentId, bytes32 indexed userId, uint256 initialScore);
    event RepUpdated       (bytes32 indexed agentId, int256 delta, uint256 newScore, bytes32 source);
    event LoanOpened       (uint256 indexed loanId, bytes32 borrower, bytes32 lender, uint256 amount, bool anomalyFlagged);
    event LoanClosed       (uint256 indexed loanId, LoanStatus status, uint256 repaidAmount);
    event ZKVouchApplied   (bytes32 indexed agentId, uint256 newScore);
    event AnomalyFlagged   (bytes32 indexed agentId, uint256 loanId, uint256 requestedAmount, uint256 trailingAvg);
    event DecayApplied     (bytes32 indexed agentId, uint256 daysInactive, uint256 newScore);
    event RepEscrowed      (bytes32 indexed agentId, uint256 loanId);
    event RepReleased      (bytes32 indexed agentId, uint256 loanId);
    event ReporterUpdated  (address indexed reporter, bool status);

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        authorisedReporters[msg.sender] = true;
    }

    // ─────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────

    function setReporter(address reporter, bool status) external onlyOwner {
        authorisedReporters[reporter] = status;
        emit ReporterUpdated(reporter, status);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_ADDR");
        owner = newOwner;
    }

    // ─────────────────────────────────────────────
    // Agent Registration
    // ─────────────────────────────────────────────

    /**
     * @notice Register a new agent with baseline score of 25.
     * @param agentId  UUID of the agent (bytes32).
     * @param userId   UUID of the owning user (bytes32) — used for self-match blocking.
     */
    function registerAgent(bytes32 agentId, bytes32 userId) external onlyReporter {
        require(!agents[agentId].registered,   "AGENT_EXISTS");
        require(agentId != bytes32(0),          "BAD_AGENT_ID");
        require(userId  != bytes32(0),          "BAD_USER_ID");

        agents[agentId] = Agent({
            agentId:          agentId,
            userId:           userId,
            score:            SCORE_NEW_AGENT,
            zkVouchUsed:      false,
            repEscrowed:      false,
            activeLoanId:     0,
            lastActivityTs:   block.timestamp,
            largestRepaid:    0,
            uncollCleanCount: 0,
            registered:       true
        });

        _appendRepEvent(agentId, 0, SCORE_NEW_AGENT, "REGISTER", 0);
        emit AgentRegistered(agentId, userId, SCORE_NEW_AGENT);
    }

    // ─────────────────────────────────────────────
    // ZK Vouching (one-time bootstrap)
    // ─────────────────────────────────────────────

    /**
     * @notice Apply one-time ZK human vouching — +8 rep, capped at 33.
     * @dev    Called by reporter after off-chain Reclaim Protocol verification.
     */
    function applyZKVouch(bytes32 agentId) external onlyReporter {
        Agent storage a = _requireAgent(agentId);
        require(!a.zkVouchUsed, "ZK_ALREADY_USED");

        a.zkVouchUsed = true;

        uint256 newScore = a.score + uint256(DELTA_ZK_VOUCH);
        // Cap at sibling bootstrap ceiling (rep 33), never above
        if (newScore > SCORE_SIBLING_CAP) newScore = SCORE_SIBLING_CAP;
        if (newScore > SCORE_MAX)         newScore = SCORE_MAX;

        int256 actualDelta = int256(newScore) - int256(a.score);
        a.score = newScore;

        _appendRepEvent(agentId, actualDelta, newScore, "ZK_VOUCH", 0);
        emit ZKVouchApplied(agentId, newScore);
        emit RepUpdated(agentId, actualDelta, newScore, "ZK_VOUCH");
    }

    // ─────────────────────────────────────────────
    // Loan Lifecycle — Open
    // ─────────────────────────────────────────────

    /**
     * @notice Record a new loan and run all pre-flight checks.
     *         Reverts if the loan violates step cap, rep escrow, or self-match.
     *         Emits AnomalyFlagged if the 5× jump is detected (does NOT revert — flags for UI).
     *
     * @param borrowerAgentId   Borrower agent UUID.
     * @param lenderAgentId     Lender agent UUID.
     * @param amount            Loan amount in USDC × PRECISION.
     * @param durationSeconds   Loan term length.
     * @param isCollateralised  Whether collateral is being posted.
     * @return loanId           Newly created loan ID.
     */
    function openLoan(
        bytes32 borrowerAgentId,
        bytes32 lenderAgentId,
        uint256 amount,
        uint256 durationSeconds,
        bool    isCollateralised
    ) external onlyReporter returns (uint256 loanId) {

        Agent storage borrower = _requireAgent(borrowerAgentId);
        Agent storage lender   = _requireAgent(lenderAgentId);

        // ── 1. Anti self-match (same userId blocked) ───────────────────
        require(borrower.userId != lender.userId, "SELF_MATCH_BLOCKED");

        // ── 2. Rep escrow gate ─────────────────────────────────────────
        require(!borrower.repEscrowed, "REP_ESCROWED_ACTIVE_LOAN");

        // ── 3. No concurrent open loan ────────────────────────────────
        require(borrower.activeLoanId == 0, "CONCURRENT_LOAN_BLOCKED");

        // ── 4. Decay before credit check ──────────────────────────────
        _applyDecay(borrowerAgentId);

        // ── 5. Rep-based max loan check ───────────────────────────────
        uint256 repBasedCap = _repBasedMaxLoan(borrower.score);
        require(amount <= repBasedCap, "EXCEEDS_REP_CAP");

        // ── 6. Loan step cap (3× largest repaid) ─────────────────────
        uint256 stepCap = _loanStepCap(borrower.largestRepaid);
        require(amount <= stepCap, "EXCEEDS_STEP_CAP");

        // ── 7. Uncollateralised ramp ───────────────────────────────────
        if (!isCollateralised) {
            require(borrower.score >= SCORE_COLLAT_CROSS, "SCORE_BELOW_UNCOLLAT_THRESHOLD");
            uint256 uncollCap = _uncollateralisedCap(borrower.uncollCleanCount);
            if (uncollCap > 0) {
                require(amount <= uncollCap, "EXCEEDS_UNCOLLAT_RAMP_CAP");
            }
        }

        // ── 8. Anomaly gate (5× trailing avg — flags, does NOT revert) ─
        bool flagged = false;
        uint256 trailingAvg = _trailingAvgLoan(borrowerAgentId);
        if (trailingAvg > 0) {
            uint256 jumpRatio = (amount * PRECISION) / trailingAvg;
            if (jumpRatio > ANOMALY_JUMP_MULT) {
                flagged = true;
                emit AnomalyFlagged(borrowerAgentId, _loanCounter + 1, amount, trailingAvg);
            }
        }

        // ── 9. Create loan record ──────────────────────────────────────
        _loanCounter++;
        loanId = _loanCounter;

        loans[loanId] = LoanRecord({
            loanId:           loanId,
            borrowerAgentId:  borrowerAgentId,
            lenderAgentId:    lenderAgentId,
            amount:           amount,
            openedAt:         block.timestamp,
            dueAt:            block.timestamp + durationSeconds,
            closedAt:         0,
            repaidAmount:     0,
            wasCollateralised: isCollateralised,
            anomalyFlagged:   flagged,
            status:           LoanStatus.Open
        });

        agentLoanIds[borrowerAgentId].push(loanId);
        agentLoanIds[lenderAgentId].push(loanId);
        _trackLoanAmount(borrowerAgentId, amount);

        // ── 10. Rep escrow for large uncollateralised loans ────────────
        if (!isCollateralised && amount >= ESCROW_THRESHOLD) {
            borrower.repEscrowed  = true;
            borrower.activeLoanId = loanId;
            emit RepEscrowed(borrowerAgentId, loanId);
        } else {
            borrower.activeLoanId = loanId;
        }

        borrower.lastActivityTs = block.timestamp;

        emit LoanOpened(loanId, borrowerAgentId, lenderAgentId, amount, flagged);
    }

    // ─────────────────────────────────────────────
    // Loan Lifecycle — Close / Repay
    // ─────────────────────────────────────────────

    /**
     * @notice Report repayment outcome and apply volume-weighted rep delta.
     *
     * @param loanId        Loan to close.
     * @param repaidAmount  Amount actually repaid (USDC × PRECISION).
     * @param profitMade    True if the agent generated alpha above interest.
     */
    function closeLoan(
        uint256     loanId,
        uint256     repaidAmount,
        bool        profitMade
    ) external onlyReporter {

        LoanRecord storage loan = loans[loanId];
        require(loan.loanId != 0,                      "LOAN_NOT_FOUND");
        require(loan.status == LoanStatus.Open,        "LOAN_NOT_OPEN");

        Agent storage borrower = _requireAgent(loan.borrowerAgentId);
        _applyDecay(loan.borrowerAgentId); // settle any pending decay first

        loan.repaidAmount = repaidAmount;
        loan.closedAt     = block.timestamp;

        // Classify outcome
        LoanStatus outcome;
        int256     baseDelta;
        bytes32    source;

        bool isLate    = block.timestamp > loan.dueAt;
        uint256 owed   = loan.amount; // principal; interest handled off-chain by matcher

        if (repaidAmount == 0) {
            // Full default
            outcome   = LoanStatus.Defaulted;
            baseDelta = DELTA_DEFAULT;
            source    = "DEFAULT";
        } else if (repaidAmount < (owed * 80) / 100) {
            // Partial (<80%)
            outcome   = LoanStatus.Partial;
            baseDelta = DELTA_PARTIAL;
            source    = "PARTIAL";
        } else if (isLate) {
            // Late (>10% past due time handled by reporter passing isLate flag)
            outcome   = LoanStatus.Late;
            baseDelta = DELTA_LATE;
            source    = "LATE";
        } else if (profitMade) {
            outcome   = LoanStatus.RepaidProfit;
            baseDelta = DELTA_REPAY_PROFIT;
            source    = "REPAY_PROFIT";
        } else {
            outcome   = LoanStatus.RepaidNoAlpha;
            baseDelta = DELTA_REPAY_NOALPHA;
            source    = "REPAY_NO_ALPHA";
        }

        // ── Volume-weighted delta (Layer 1) ────────────────────────────
        // scale_factor = min(PRECISION, loan.amount × PRECISION / repBasedCap)
        // For negative deltas: apply full delta (no volume discount on penalties)
        int256 weightedDelta;
        if (baseDelta > 0) {
            uint256 repBasedCap = _repBasedMaxLoan(borrower.score);
            uint256 scaleFactor = repBasedCap > 0
                ? _min(PRECISION, (loan.amount * PRECISION) / repBasedCap)
                : PRECISION;
            weightedDelta = (baseDelta * int256(scaleFactor)) / int256(PRECISION);
            // Minimum +1 unit of precision for any positive repayment (floor)
            if (weightedDelta == 0) weightedDelta = 1;
        } else {
            weightedDelta = baseDelta; // full penalty always applies
        }

        // ── Apply delta ────────────────────────────────────────────────
        _applyDelta(loan.borrowerAgentId, weightedDelta, source, loanId);

        // ── Update bookkeeping ─────────────────────────────────────────
        loan.status = outcome;

        if (outcome == LoanStatus.RepaidProfit || outcome == LoanStatus.RepaidNoAlpha) {
            // Update largest repaid
            if (loan.amount > borrower.largestRepaid) {
                borrower.largestRepaid = loan.amount;
            }
            // Increment uncollateralised clean count
            if (!loan.wasCollateralised) {
                borrower.uncollCleanCount++;
            }
        }

        // ── Release rep escrow ────────────────────────────────────────
        if (borrower.repEscrowed && borrower.activeLoanId == loanId) {
            borrower.repEscrowed  = false;
            borrower.activeLoanId = 0;
            emit RepReleased(loan.borrowerAgentId, loanId);
        } else {
            borrower.activeLoanId = 0;
        }

        borrower.lastActivityTs = block.timestamp;

        emit LoanClosed(loanId, outcome, repaidAmount);
    }

    // ─────────────────────────────────────────────
    // Sibling Bootstrap
    // ─────────────────────────────────────────────

    /**
     * @notice Apply sibling bootstrap bonus from a newly registered agent.
     *
     * Off-chain computation (to avoid gas-heavy loops):
     *   S = Σ(rep_i × crossUserVolume_i) / Σ(crossUserVolume_i)
     *   bonus = min(8, S − 25)
     *   initialScore = 25 + bonus (max 33)
     *
     * The reporter passes in the computed S and sibling volumes; we verify the
     * cap and that the agent is still at baseline before applying.
     *
     * @param agentId           Agent to boost.
     * @param weightedAvgScore  Off-chain computed S (scaled ×PRECISION).
     */
    function applySiblingBootstrap(
        bytes32 agentId,
        uint256 weightedAvgScore
    ) external onlyReporter {
        Agent storage a = _requireAgent(agentId);
        require(a.score == SCORE_NEW_AGENT, "NOT_AT_BASELINE"); // only at registration

        if (weightedAvgScore <= SCORE_NEW_AGENT) return; // no bonus

        uint256 rawBonus     = weightedAvgScore - SCORE_NEW_AGENT;
        uint256 cappedBonus  = rawBonus > uint256(DELTA_ZK_VOUCH) ? uint256(DELTA_ZK_VOUCH) : rawBonus;
        uint256 newScore     = SCORE_NEW_AGENT + cappedBonus;
        if (newScore > SCORE_SIBLING_CAP) newScore = SCORE_SIBLING_CAP;

        int256 delta = int256(newScore) - int256(a.score);
        a.score = newScore;

        _appendRepEvent(agentId, delta, newScore, "SIBLING_BOOTSTRAP", 0);
        emit RepUpdated(agentId, delta, newScore, "SIBLING_BOOTSTRAP");
    }

    // ─────────────────────────────────────────────
    // Inactivity Decay (can be called by anyone)
    // ─────────────────────────────────────────────

    /**
     * @notice Trigger inactivity decay for an agent.
     *         −0.5 rep per 30 days after 60 days of inactivity.
     *         Callable by any address (permissionless maintenance).
     */
    function triggerDecay(bytes32 agentId) external {
        _applyDecay(agentId);
    }

    // ─────────────────────────────────────────────
    // View Helpers — Credit Assessment
    // ─────────────────────────────────────────────

    /**
     * @notice Full credit profile snapshot for a borrower agent.
     * @return score               Current rep score (scaled ×PRECISION).
     * @return collateralBPS       Required collateral in basis points.
     * @return maxLoanAmount       Maximum allowed loan (USDC, scaled).
     * @return interestFloorBPS    Minimum interest rate in basis points.
     * @return uncollCap           Current uncollateralised loan cap (0 = unlimited).
     * @return isEscrowed          True if rep is locked due to active large loan.
     * @return stepCap             Loan step cap (3× largest repaid, scaled).
     */
    function getCreditProfile(bytes32 agentId)
        external
        view
        returns (
            uint256 score,
            uint256 collateralBPS,
            uint256 maxLoanAmount,
            uint256 interestFloorBPS,
            uint256 uncollCap,
            bool    isEscrowed,
            uint256 stepCap
        )
    {
        Agent storage a = _requireAgentView(agentId);
        score            = _decayedScore(a);
        collateralBPS    = _collateralBPS(score);
        maxLoanAmount    = _min(_repBasedMaxLoan(score), _loanStepCap(a.largestRepaid));
        interestFloorBPS = _interestFloorBPS(score);
        uncollCap        = score >= SCORE_COLLAT_CROSS
                               ? _uncollateralisedCap(a.uncollCleanCount)
                               : type(uint256).max; // irrelevant — collat required anyway
        isEscrowed       = a.repEscrowed;
        stepCap          = _loanStepCap(a.largestRepaid);
    }

    /**
     * @notice Human-readable score (no PRECISION scaling).
     *         Returns score × 10000 for 4 decimals e.g. 250000 = 25.0000
     */
    function getScore(bytes32 agentId) external view returns (uint256) {
        Agent storage a = _requireAgentView(agentId);
        return _decayedScore(a);
    }

    /**
     * @notice Check if two agents can be matched (anti self-match).
     */
    function canMatch(bytes32 lenderAgentId, bytes32 borrowerAgentId)
        external
        view
        returns (bool ok, string memory reason)
    {
        if (!agents[lenderAgentId].registered)  return (false, "LENDER_NOT_REGISTERED");
        if (!agents[borrowerAgentId].registered) return (false, "BORROWER_NOT_REGISTERED");

        Agent storage lender   = agents[lenderAgentId];
        Agent storage borrower = agents[borrowerAgentId];

        if (lender.userId == borrower.userId)   return (false, "SELF_MATCH");
        if (borrower.repEscrowed)               return (false, "BORROWER_ESCROWED");
        if (borrower.activeLoanId != 0)         return (false, "CONCURRENT_LOAN");

        return (true, "OK");
    }

    /**
     * @notice Pre-flight check for a proposed loan — returns detailed rejection reason.
     */
    function checkLoanEligibility(
        bytes32 borrowerAgentId,
        uint256 amount,
        bool    isCollateralised
    ) external view returns (bool eligible, string memory reason) {
        if (!agents[borrowerAgentId].registered) return (false, "NOT_REGISTERED");

        Agent storage a = _requireAgentView(borrowerAgentId);
        uint256 score   = _decayedScore(a);

        if (a.repEscrowed)       return (false, "REP_ESCROWED");
        if (a.activeLoanId != 0) return (false, "ACTIVE_LOAN_EXISTS");

        uint256 repCap  = _repBasedMaxLoan(score);
        if (amount > repCap)     return (false, "EXCEEDS_REP_CAP");

        uint256 sCap    = _loanStepCap(a.largestRepaid);
        if (amount > sCap)       return (false, "EXCEEDS_STEP_CAP");

        if (!isCollateralised) {
            if (score < SCORE_COLLAT_CROSS) return (false, "SCORE_BELOW_UNCOLLAT_THRESHOLD");
            uint256 uCap = _uncollateralisedCap(a.uncollCleanCount);
            if (uCap > 0 && amount > uCap)  return (false, "EXCEEDS_UNCOLLAT_RAMP_CAP");
        }

        return (true, "ELIGIBLE");
    }

    /**
     * @notice Return full rep event history for an agent.
     */
    function getRepHistory(bytes32 agentId) external view returns (RepEvent[] memory) {
        return repHistory[agentId];
    }

    /**
     * @notice Return all loan IDs for an agent.
     */
    function getAgentLoanIds(bytes32 agentId) external view returns (uint256[] memory) {
        return agentLoanIds[agentId];
    }

    // ─────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────

    function _requireAgent(bytes32 agentId) internal view returns (Agent storage a) {
        a = agents[agentId];
        require(a.registered, "AGENT_NOT_FOUND");
    }

    function _requireAgentView(bytes32 agentId) internal view returns (Agent storage a) {
        a = agents[agentId];
        require(a.registered, "AGENT_NOT_FOUND");
    }

    /// @dev Apply inactivity decay and persist new score.
    function _applyDecay(bytes32 agentId) internal {
        Agent storage a = agents[agentId];
        if (!a.registered) return;

        uint256 elapsed = block.timestamp - a.lastActivityTs;
        if (elapsed <= INACTIVITY_WINDOW) return;

        // Number of complete 30-day periods beyond the 60-day grace window
        uint256 decayPeriods = (elapsed - INACTIVITY_WINDOW) / DECAY_PERIOD;
        if (decayPeriods == 0) return;

        int256 totalDecay = int256(decayPeriods) * DELTA_INACTIVITY;
        _applyDelta(agentId, totalDecay, "INACTIVITY_DECAY", 0);

        // Advance lastActivityTs by the consumed decay periods (avoids reapplying)
        a.lastActivityTs += decayPeriods * DECAY_PERIOD;

        emit DecayApplied(agentId, elapsed / 1 days, a.score);
    }

    /// @dev Compute decayed score without writing state (view-safe).
    function _decayedScore(Agent storage a) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - a.lastActivityTs;
        if (elapsed <= INACTIVITY_WINDOW) return a.score;

        uint256 decayPeriods = (elapsed - INACTIVITY_WINDOW) / DECAY_PERIOD;
        if (decayPeriods == 0) return a.score;

        uint256 totalDecay = decayPeriods * uint256(-DELTA_INACTIVITY); // positive magnitude
        return a.score >= totalDecay ? a.score - totalDecay : SCORE_MIN;
    }

    /// @dev Apply a signed delta and clamp to [SCORE_MIN, SCORE_MAX].
    function _applyDelta(
        bytes32 agentId,
        int256  delta,
        bytes32 source,
        uint256 loanId
    ) internal {
        Agent storage a = agents[agentId];
        int256 current  = int256(a.score);
        int256 next     = current + delta;

        if (next < int256(SCORE_MIN)) next = int256(SCORE_MIN);
        if (next > int256(SCORE_MAX)) next = int256(SCORE_MAX);

        a.score = uint256(next);
        _appendRepEvent(agentId, delta, a.score, source, loanId);
        emit RepUpdated(agentId, delta, a.score, source);
    }

    function _appendRepEvent(
        bytes32 agentId,
        int256  delta,
        uint256 newScore,
        bytes32 source,
        uint256 loanId
    ) internal {
        repHistory[agentId].push(RepEvent({
            timestamp: block.timestamp,
            delta:     delta,
            newScore:  newScore,
            source:    source,
            loanId:    loanId
        }));
    }

    /// @dev collateral% = max(0, (35 − rep) × 2.86)  expressed as basis points.
    function _collateralBPS(uint256 score) internal pure returns (uint256) {
        if (score >= SCORE_COLLAT_CROSS) return 0;
        uint256 repUnitsBelow = (SCORE_COLLAT_CROSS - score) / PRECISION; // whole rep units
        return repUnitsBelow * COLLAT_SLOPE_BPS;
    }

    /// @dev max_loan = rep × 20  (USDC, scaled).
    function _repBasedMaxLoan(uint256 score) internal pure returns (uint256) {
        return (score * MAX_LOAN_PER_REP) / PRECISION / PRECISION;
        // score/PRECISION = rep units; × 20 USDC; × PRECISION to keep scale
        // simplified: score × 20 / PRECISION
    }

    /// @dev Step cap = max(FIRST_LOAN_HARD_CAP, largestRepaid × 3).
    function _loanStepCap(uint256 largestRepaid) internal pure returns (uint256) {
        if (largestRepaid == 0) return FIRST_LOAN_HARD_CAP;
        uint256 step = (largestRepaid * LOAN_STEP_MULT) / PRECISION;
        return step > FIRST_LOAN_HARD_CAP ? step : FIRST_LOAN_HARD_CAP;
    }

    /// @dev interest floor in bps = max(50, 350 − rep × 6).
    function _interestFloorBPS(uint256 score) internal pure returns (uint256) {
        uint256 repUnits = score / PRECISION;
        uint256 computed = INTEREST_BASE_BPS > repUnits * INTEREST_SLOPE
            ? INTEREST_BASE_BPS - repUnits * INTEREST_SLOPE
            : 0;
        return computed > INTEREST_FLOOR_BPS ? computed : INTEREST_FLOOR_BPS;
    }

    /// @dev Uncollateralised cap from ramp table. 0 = unlimited.
    function _uncollateralisedCap(uint256 cleanCount) internal view returns (uint256) {
        uint256 idx = cleanCount >= 5 ? 5 : cleanCount;
        return UNCOLLAT_RAMP[idx];
    }

    /// @dev Trailing average of last 10 loan amounts for this agent.
    function _trailingAvgLoan(bytes32 agentId) internal view returns (uint256) {
        uint256[] storage amounts = _loanAmounts[agentId];
        if (amounts.length == 0) return 0;
        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) sum += amounts[i];
        return sum / amounts.length;
    }

    /// @dev Store loan amount in a ring buffer of size 10.
    function _trackLoanAmount(bytes32 agentId, uint256 amount) internal {
        uint256[] storage arr = _loanAmounts[agentId];
        if (arr.length < 10) {
            arr.push(amount);
        } else {
            // Shift left and append
            for (uint256 i = 0; i < 9; i++) arr[i] = arr[i + 1];
            arr[9] = amount;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
