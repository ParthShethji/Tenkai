// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentCreditScore
 * @notice Reputation-gated credit scoring for AI agents in the AgentFi protocol.
 *
 * SCORE COMPOSITION (max 100 points)
 * ─────────────────────────────────
 *  Base bootstrap (human ZK attestation)   : 0–40 pts  (one-time, set at registration)
 *  Repayment history                        : 0–35 pts  (earned over time)
 *  Loan volume & consistency                : 0–15 pts  (earned over time)
 *  Age / longevity bonus                    : 0–10 pts  (earned over time)
 *
 * PENALTIES
 * ─────────
 *  Late repayment    : –5 pts per occurrence
 *  Default           : –30 pts per occurrence (floor: 0)
 *  Partial repayment : –10 pts per occurrence
 */

contract AgentCreditScore {

    // ─────────────────────────────────────────────────────────────
    // STRUCTS
    // ─────────────────────────────────────────────────────────────

    struct Agent {
        address wallet;
        string  ensName;            // e.g. "trader-gamma.agentfi.eth"
        address humanOwner;         // the human who bootstrapped this agent

        // Scoring components (raw counters, score derived on read)
        uint256 bootstrapScore;     // 0–40, set once at registration
        uint256 totalLoans;         // number of loans ever taken
        uint256 successfulRepays;   // on-time full repayments
        uint256 lateRepays;         // repaid but past due date
        uint256 partialRepays;      // repaid but less than full amount
        uint256 defaults;           // never repaid / forcibly defaulted
        uint256 totalVolumeUSDC;    // cumulative USDC borrowed (6 decimals)
        uint256 registeredAt;       // block.timestamp at registration
        bool    exists;
    }

    struct Loan {
        address borrower;
        address lender;
        uint256 principal;          // USDC, 6 decimals
        uint256 interest;           // USDC, 6 decimals
        uint256 dueTimestamp;
        LoanStatus status;
    }

    enum LoanStatus { Active, RepaidOnTime, RepaidLate, Partial, Defaulted }

    // ─────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────

    mapping(address => Agent)  public agents;
    mapping(uint256 => Loan)   public loans;
    mapping(address => bool)   public authorizedProtocol; // lending contracts

    uint256 public loanCounter;
    address public owner;

    // Score thresholds for loan tiers
    uint256 public constant TIER_NEW        = 40;   // bootstrap only, small loans
    uint256 public constant TIER_STANDARD   = 60;   // earned some history
    uint256 public constant TIER_TRUSTED    = 80;   // strong track record

    // ─────────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string ensName, uint256 bootstrapScore);
    event LoanOpened(uint256 indexed loanId, address borrower, address lender, uint256 principal);
    event LoanRepaid(uint256 indexed loanId, LoanStatus status, uint256 newScore);
    event AgentDefaulted(uint256 indexed loanId, address borrower, uint256 newScore);
    event ScoreUpdated(address indexed agent, uint256 oldScore, uint256 newScore);

    // ─────────────────────────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyProtocol() {
        require(authorizedProtocol[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    modifier agentExists(address _agent) {
        require(agents[_agent].exists, "Agent not registered");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        authorizedProtocol[msg.sender] = true;
    }

    // ─────────────────────────────────────────────────────────────
    // REGISTRATION
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register a new agent.
     * @param _agentWallet   The agent's operational wallet address.
     * @param _ensName       Human-readable ENS name.
     * @param _bootstrapTier 0 = no attestation (score 0)
     *                       1 = basic human proof   (score 20)
     *                       2 = KYC'd exchange proof (score 30)
     *                       3 = full institutional   (score 40)
     *
     * In production, _bootstrapTier is validated against an off-chain
     * Reclaim Protocol ZK proof verified by a trusted verifier contract.
     * For the hackathon, the owner/protocol sets this directly.
     */
    function registerAgent(
        address _agentWallet,
        string  calldata _ensName,
        uint8   _bootstrapTier
    ) external {
        require(!agents[_agentWallet].exists, "Already registered");
        require(_bootstrapTier <= 3, "Invalid tier");

        uint256 bootstrap = _tierToScore(_bootstrapTier);

        agents[_agentWallet] = Agent({
            wallet:           _agentWallet,
            ensName:          _ensName,
            humanOwner:       msg.sender,
            bootstrapScore:   bootstrap,
            totalLoans:       0,
            successfulRepays: 0,
            lateRepays:       0,
            partialRepays:    0,
            defaults:         0,
            totalVolumeUSDC:  0,
            registeredAt:     block.timestamp,
            exists:           true
        });

        emit AgentRegistered(_agentWallet, _ensName, bootstrap);
    }

    // ─────────────────────────────────────────────────────────────
    // LOAN LIFECYCLE  (called by the lending protocol contract)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Open a new loan record. Called by the lending contract after
     *         it validates the borrower's score meets the lender's threshold.
     */
    function openLoan(
        address _borrower,
        address _lender,
        uint256 _principal,
        uint256 _interest,
        uint256 _durationSeconds
    ) external onlyProtocol agentExists(_borrower) returns (uint256 loanId) {
        loanId = ++loanCounter;

        loans[loanId] = Loan({
            borrower:     _borrower,
            lender:       _lender,
            principal:    _principal,
            interest:     _interest,
            dueTimestamp: block.timestamp + _durationSeconds,
            status:       LoanStatus.Active
        });

        agents[_borrower].totalLoans++;
        agents[_borrower].totalVolumeUSDC += _principal;

        emit LoanOpened(loanId, _borrower, _lender, _principal);
    }

    /**
     * @notice Record a repayment. The lending contract calls this after
     *         funds have physically moved.
     * @param _amountPaid  Actual USDC amount paid back (principal + interest).
     */
    function recordRepayment(
        uint256 _loanId,
        uint256 _amountPaid
    ) external onlyProtocol {
        Loan storage loan = loans[_loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");

        uint256 fullAmount = loan.principal + loan.interest;
        uint256 oldScore   = getCreditScore(loan.borrower);
        LoanStatus status;

        if (_amountPaid >= fullAmount) {
            if (block.timestamp <= loan.dueTimestamp) {
                status = LoanStatus.RepaidOnTime;
                agents[loan.borrower].successfulRepays++;
            } else {
                status = LoanStatus.RepaidLate;
                agents[loan.borrower].lateRepays++;
            }
        } else {
            status = LoanStatus.Partial;
            agents[loan.borrower].partialRepays++;
        }

        loan.status = status;
        uint256 newScore = getCreditScore(loan.borrower);

        emit LoanRepaid(_loanId, status, newScore);
        emit ScoreUpdated(loan.borrower, oldScore, newScore);
    }

    /**
     * @notice Mark a loan as defaulted. Called by lending contract after
     *         grace period expires with no repayment.
     */
    function recordDefault(uint256 _loanId) external onlyProtocol {
        Loan storage loan = loans[_loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");

        uint256 oldScore = getCreditScore(loan.borrower);
        loan.status = LoanStatus.Defaulted;
        agents[loan.borrower].defaults++;

        uint256 newScore = getCreditScore(loan.borrower);
        emit AgentDefaulted(_loanId, loan.borrower, newScore);
        emit ScoreUpdated(loan.borrower, oldScore, newScore);
    }

    // ─────────────────────────────────────────────────────────────
    // SCORE CALCULATION  (pure, read-only, cheap to call)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Derive the current credit score for an agent.
     *         Score is calculated fresh each time — no stale storage.
     *
     * FORMULA:
     *   score = bootstrapScore
     *         + repaymentScore   (0–35)
     *         + volumeScore      (0–15)
     *         + ageScore         (0–10)
     *         - penalties
     *   clamped to [0, 100]
     */
    function getCreditScore(address _agent) public view returns (uint256) {
        if (!agents[_agent].exists) return 0;

        Agent storage a = agents[_agent];
        int256 score = int256(a.bootstrapScore);

        // ── Repayment score (0–35) ──────────────────────────────
        uint256 repayPoints = a.successfulRepays * 5;
        if (repayPoints > 35) repayPoints = 35;
        score += int256(repayPoints);

        // ── Volume score (0–15) ─────────────────────────────────
        score += int256(_volumeScore(a.totalVolumeUSDC));

        // ── Age / longevity score (0–10) ────────────────────────
        uint256 periods = (block.timestamp - a.registeredAt) / 30 days;
        uint256 agePoints = periods * 2;
        if (agePoints > 10) agePoints = 10;
        score += int256(agePoints);

        // ── Penalties ───────────────────────────────────────────
        score -= int256(a.lateRepays    * 5);
        score -= int256(a.partialRepays * 10);
        score -= int256(a.defaults      * 30);

        // ── Clamp to [0, 100] ───────────────────────────────────
        if (score < 0)   return 0;
        if (score > 100) return 100;
        return uint256(score);
    }

    /**
     * @notice Return the loan tier an agent qualifies for.
     *         Lender agents use this to gate loan approvals.
     */
    function getLoanTier(address _agent) external view returns (
        uint8  tier,
        string memory label,
        uint256 maxLoanUSDC
    ) {
        uint256 score = getCreditScore(_agent);

        if (score >= TIER_TRUSTED)  return (3, "TRUSTED",     50_000 * 1e6);
        if (score >= TIER_STANDARD) return (2, "STANDARD",     5_000 * 1e6);
        if (score >= TIER_NEW)      return (1, "NEW",            500 * 1e6);
        return (0, "UNQUALIFIED", 0);
    }

    /**
     * @notice Single gate call used by the lending contract before disbursing.
     */
    function meetsThreshold(
        address _borrower,
        uint256 _minScore,
        uint256 _requestedAmount
    ) external view returns (bool approved, string memory reason) {
        if (!agents[_borrower].exists)
            return (false, "Agent not registered");

        uint256 score = getCreditScore(_borrower);
        if (score < _minScore)
            return (false, "Score below lender threshold");

        (, , uint256 maxLoan) = this.getLoanTier(_borrower);
        if (_requestedAmount > maxLoan)
            return (false, "Amount exceeds tier limit");

        return (true, "Approved");
    }

    // ─────────────────────────────────────────────────────────────
    // VIEW HELPERS
    // ─────────────────────────────────────────────────────────────

    /// @notice Full agent snapshot for the demo dashboard
    function getAgentProfile(address _agent) external view returns (
        string  memory ensName,
        uint256 creditScore,
        uint256 totalLoans,
        uint256 successfulRepays,
        uint256 defaults,
        uint256 totalVolumeUSDC,
        uint8   tier
    ) {
        Agent storage a = agents[_agent];
        uint256 score   = getCreditScore(_agent);
        (uint8 t,,)     = this.getLoanTier(_agent);
        return (a.ensName, score, a.totalLoans, a.successfulRepays,
                a.defaults, a.totalVolumeUSDC, t);
    }

    // ─────────────────────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────────────────────

    function setAuthorizedProtocol(address _protocol, bool _auth) external onlyOwner {
        authorizedProtocol[_protocol] = _auth;
    }

    /**
     * @notice Bump bootstrap score after ZK proof verification.
     *         In production, called by the Reclaim verifier contract.
     */
    function updateBootstrapScore(address _agent, uint256 _newScore)
        external onlyProtocol agentExists(_agent)
    {
        require(_newScore <= 40, "Bootstrap max is 40");
        agents[_agent].bootstrapScore = _newScore;
    }

    // ─────────────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────────────

    function _tierToScore(uint8 _tier) internal pure returns (uint256) {
        if (_tier == 1) return 20;
        if (_tier == 2) return 30;
        if (_tier == 3) return 40;
        return 0;
    }

    function _volumeScore(uint256 _volumeUSDC) internal pure returns (uint256) {
        uint256 v = _volumeUSDC / 1e6;
        if (v >= 100_000) return 15;
        if (v >= 50_000)  return 12;
        if (v >= 20_000)  return 9;
        if (v >= 5_000)   return 6;
        if (v >= 1_000)   return 3;
        return 0;
    }
}
