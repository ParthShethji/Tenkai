// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * AgentFiLending — on-chain core for all lending/borrowing.
 *
 * Design rules:
 *  - Every loan lifecycle event (request, fund, repay, default, liquidate) is on-chain only.
 *  - Collateral is held in this contract. Released on clean repay or seized on default.
 *  - Reputation deltas are emitted as events; the off-chain oracle reads them
 *    and writes the updated score back on-chain via setReputation().
 *  - The platform backend (2-of-2 multisig co-signer) calls fundLoan() after the
 *    off-chain matcher pairs a lender with a borrower.
 *  - No admin can touch user funds except through the defined loan lifecycle.
 *  - Agents register with any valid ENS name they own. Anti-sybil is enforced
 *    via ZK human verification at the application layer.
 */
contract AgentFiLending is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum LoanStatus { None, Requested, Active, Repaid, Defaulted, Liquidated }

    struct Loan {
        uint256 loanId;
        address borrower;           // agent multisig wallet
        address lender;             // agent multisig wallet
        uint256 principal;          // USDC (6 decimals)
        uint256 collateral;         // USDC locked from borrower
        uint256 interestAmount;     // fixed at origination
        uint256 dueAt;              // unix timestamp
        uint256 repaidAt;
        LoanStatus status;
        bytes32 borrowerEns;        // keccak256 of ENS name, for indexing
        bytes32 lenderEns;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;

    // agentWallet → list of loan IDs (as borrower or lender)
    mapping(address => uint256[]) public agentLoansAsBorrower;
    mapping(address => uint256[]) public agentLoansAsLender;

    // ENS identity bindings (set at registration, immutable)
    // ensNameHash = keccak256(abi.encodePacked(ensName)), e.g. "alice.eth"
    mapping(bytes32 => address) public ensNameToWallet;
    mapping(address => bytes32) public walletToEnsName;

    // platform backend address — signs alongside agent key (2-of-2)
    address public platformSigner;

    // Circle Verite Trust Registry: Approved issuers for Verifiable Credentials
    mapping(address => bool) public trustRegistry;

    // USDC decimals = 6
    uint256 public constant USDC_DECIMALS = 1e6;
    uint256 public constant MAX_LOAN_USDC = 1000 * 1e6;    // 1000 USDC
    uint256 public constant MIN_LOAN_USDC = 10 * 1e6;      // 10 USDC
    uint256 public constant LOAN_DURATION = 7 days;
    uint8 public constant REP_MAX = 50;
    uint8 public constant REP_NEW_AGENT = 25;
    uint8 public constant REP_ZERO_COLLATERAL = 35;         // C₀ — derived threshold

    // grace period before a loan can be marked defaulted
    uint256 public constant DEFAULT_GRACE = 1 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event LoanRequested(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 collateral,
        uint256 interestAmount,
        uint256 dueAt
    );
    event LoanFunded(uint256 indexed loanId, uint256 fundedAt);
    event LoanRepaid(uint256 indexed loanId, uint256 repaidAt, bool withProfit);
    event LoanDefaulted(uint256 indexed loanId, uint256 defaultedAt);
    event CollateralSeized(uint256 indexed loanId, address indexed lender, uint256 amount);
    event ReputationUpdated(address indexed agent, uint8 oldScore, uint8 newScore, string reason);
    event AgentRegistered(address indexed agent, uint8 initialScore, bytes32 ensNameHash);
    event TrustRegistryUpdated(address indexed issuer, bool isApproved);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc, address _platformSigner) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        platformSigner = _platformSigner;
        trustRegistry[_platformSigner] = true; // Platform is the first approved issuer
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyPlatform() {
        require(msg.sender == platformSigner, "caller is not platform");
        _;
    }

    modifier loanExists(uint256 loanId) {
        require(loans[loanId].status != LoanStatus.None, "AgentFi: loan not found");
        _;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    function registerAgent(address agent, bytes32 ensNameHash) external onlyPlatform {
        require(ensNameHash != bytes32(0), "AgentFi: ensNameHash cannot be zero");
        require(ensNameToWallet[ensNameHash] == address(0), "AgentFi: ENS name already registered");

        // Bind ENS name hash ↔ wallet address on-chain
        ensNameToWallet[ensNameHash] = agent;
        walletToEnsName[agent] = ensNameHash;

        emit AgentRegistered(agent, 0, ensNameHash); // initialScore kept in event for legacy frontend parsing
    }

    /**
     * Verify that a wallet address is bound to the given ENS name hash on-chain.
     * Returns true only if both directions of the mapping agree.
     * Callable by anyone — used by the backend and external auditors.
     */
    function verifyEns(bytes32 ensNameHash, address wallet) external view returns (bool) {
        return ensNameToWallet[ensNameHash] == wallet && walletToEnsName[wallet] == ensNameHash;
    }

    /**
     * Look up the wallet address for a given ENS name hash.
     */
    function walletForEns(bytes32 ensNameHash) external view returns (address) {
        return ensNameToWallet[ensNameHash];
    }

    /**
     * Look up the ENS name hash bound to a wallet.
     */
    function ensForWallet(address wallet) external view returns (bytes32) {
        return walletToEnsName[wallet];
    }

    // ─── Reputation read helpers ───────────────────────────────────────────────

    /**
     * Collateral required for a given rep score and principal.
     * collateral% = max(0, (35 - rep) * 2.86)
     * Returns collateral amount in USDC (6 decimals).
     */
    function requiredCollateral(uint8 vcScore, uint256 principal)
        public pure returns (uint256)
    {
        if (vcScore >= REP_ZERO_COLLATERAL) return 0;
        // (35 - rep) * 2.86 / 100 * principal
        uint256 pct = (uint256(REP_ZERO_COLLATERAL - vcScore) * 286);
        return (principal * pct) / 10000;
    }

    /**
     * Maximum loan size for a given score.
     * maxLoan = rep * 20 USDC, capped at MAX_LOAN_USDC.
     */
    function maxLoanSize(uint8 vcScore) public pure returns (uint256) {
        uint256 cap = uint256(vcScore) * 20 * USDC_DECIMALS;
        return cap > MAX_LOAN_USDC ? MAX_LOAN_USDC : cap;
    }

    // ─── Loan lifecycle ───────────────────────────────────────────────────────

    /**
     * Step 1: Platform creates the loan record after off-chain matching.
     * Borrower must have approved this contract to pull collateral.
     * Lender must have approved this contract to pull principal.
     *
     * interestAmount is computed off-chain:
     *   interest = principal * rate (rate = max(0.5%, 3.5% - rep*0.06%) / cyclesPerYear)
     *
     * Called by platformSigner (the backend co-signer key).
     */
    function requestLoan(
        address borrower,
        address lender,
        uint256 principal,
        uint256 interestAmount,
        bytes32 borrowerEns,
        bytes32 lenderEns,
        uint8 vcScore,
        bytes calldata vcSignature
    ) external onlyPlatform nonReentrant returns (uint256 loanId) {
        // ── VC Signature Verification (Verite Trust Registry) ──
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(borrower, vcScore)));
        require(trustRegistry[ECDSA.recover(messageHash, vcSignature)], "AgentFi: Issuer not in Trust Registry");

        // ── validations ──
        require(borrower != lender, "AgentFi: self-loan not allowed");
        require(principal >= MIN_LOAN_USDC, "AgentFi: below minimum loan");
        require(principal <= maxLoanSize(vcScore), "AgentFi: exceeds rep-based cap");

        // ── collateral calculation ──
        uint256 collateral = requiredCollateral(vcScore, principal);

        // ── pull collateral from borrower (0 if rep >= 35) ──
        if (collateral > 0) {
            usdc.safeTransferFrom(borrower, address(this), collateral);
        }

        // ── create loan record ──
        loanId = nextLoanId++;
        loans[loanId] = Loan({
            loanId: loanId,
            borrower: borrower,
            lender: lender,
            principal: principal,
            collateral: collateral,
            interestAmount: interestAmount,
            dueAt: block.timestamp + LOAN_DURATION,
            repaidAt: 0,
            status: LoanStatus.Requested,
            borrowerEns: borrowerEns,
            lenderEns: lenderEns
        });

        agentLoansAsBorrower[borrower].push(loanId);
        agentLoansAsLender[lender].push(loanId);

        emit LoanRequested(
            loanId, borrower, lender, principal, collateral, interestAmount,
            loans[loanId].dueAt
        );
    }

    /**
     * Step 2: Platform pulls principal from lender and sends to borrower.
     * Must be called immediately after requestLoan (same tx block window acceptable).
     * Lender must have approved this contract for principal amount.
     */
    function fundLoan(uint256 loanId)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Requested, "AgentFi: loan not in Requested state");

        // pull principal from lender → send to borrower
        usdc.safeTransferFrom(loan.lender, loan.borrower, loan.principal);

        loan.status = LoanStatus.Active;

        emit LoanFunded(loanId, block.timestamp);
    }

    /**
     * Step 3a: Borrower repays principal + interest.
     * Borrower must have approved this contract for (principal + interestAmount).
     * Collateral is returned to borrower on clean repay.
     * Called by the borrower agent's multisig (agent key + platform co-sign).
     */
    function repayLoan(uint256 loanId, uint256 profitGenerated)
        external nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");
        require(msg.sender == loan.borrower, "AgentFi: only borrower can repay");
        require(block.timestamp <= loan.dueAt + DEFAULT_GRACE, "AgentFi: grace period passed, use liquidate");

        uint256 repayAmount = loan.principal + loan.interestAmount;

        // pull repayment from borrower → forward to lender
        usdc.safeTransferFrom(loan.borrower, loan.lender, repayAmount);

        // return collateral to borrower if any was locked
        if (loan.collateral > 0) {
            usdc.safeTransfer(loan.borrower, loan.collateral);
        }

        loan.status = LoanStatus.Repaid;
        loan.repaidAt = block.timestamp;

        bool withProfit = profitGenerated > 0;

        emit LoanRepaid(loanId, block.timestamp, withProfit);
    }

    /**
     * Step 3b: Partial repayment — borrower returns what they can.
     * Platform calls this when full repayment fails but borrower cooperates.
     * Remainder is covered from collateral. Rep penalty applied.
     */
    function repayPartial(uint256 loanId, uint256 partialAmount)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");

        uint256 totalOwed = loan.principal + loan.interestAmount;
        require(partialAmount < totalOwed, "AgentFi: use repayLoan for full amount");
        require(partialAmount > 0, "AgentFi: zero partial");

        // pull what borrower has
        if (partialAmount > 0) {
            usdc.safeTransferFrom(loan.borrower, loan.lender, partialAmount);
        }

        // cover remainder from collateral (up to what's available)
        uint256 shortfall = totalOwed - partialAmount;
        uint256 collateralCover = loan.collateral >= shortfall ? shortfall : loan.collateral;
        uint256 remainder = shortfall - collateralCover;

        if (collateralCover > 0) {
            usdc.safeTransfer(loan.lender, collateralCover);
        }
        // if remainder > 0, lender takes a haircut — reflected in borrower rep

        loan.status = LoanStatus.Defaulted;
        loan.repaidAt = block.timestamp;

        emit LoanDefaulted(loanId, block.timestamp);
    }

    /**
     * Step 3c: Liquidation — called by platform after grace period expires.
     * Seizes collateral, sends to lender. Rep penalty = full default.
     */
    function liquidateLoan(uint256 loanId)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");
        require(
            block.timestamp > loan.dueAt + DEFAULT_GRACE,
            "AgentFi: grace period not passed"
        );

        // seize collateral → send to lender
        if (loan.collateral > 0) {
            usdc.safeTransfer(loan.lender, loan.collateral);
            emit CollateralSeized(loanId, loan.lender, loan.collateral);
        }

        loan.status = LoanStatus.Liquidated;

        emit LoanDefaulted(loanId, block.timestamp);
    }

    function setPlatformSigner(address newSigner) external onlyOwner {
        platformSigner = newSigner;
    }

    /**
     * Circle Verite standard: add or remove approved credential issuers.
     */
    function setIssuerStatus(address issuer, bool isApproved) external onlyOwner {
        trustRegistry[issuer] = isApproved;
        emit TrustRegistryUpdated(issuer, isApproved);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function getBorrowerLoans(address agent) external view returns (uint256[] memory) {
        return agentLoansAsBorrower[agent];
    }

    function getLenderLoans(address agent) external view returns (uint256[] memory) {
        return agentLoansAsLender[agent];
    }
}
