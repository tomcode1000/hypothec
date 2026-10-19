// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Minimal ERC-20 surface used here (USDC).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// EIP-2612, which Circle's USDC implements: an approval given by signature, no transaction.
interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

/// @title Hypothec loans: the USDC side of a Hypothec loan.
/// @notice The ZEC collateral sits in a shielded 3-of-4 FROST vault on Zcash (borrower,
/// lender, two referees). This contract holds the public half: terms, payout, repayment,
/// deadline. It stores nothing about the collateral (no amount, no vault address): that
/// stays shielded. The referees read this contract to decide what to sign on Zcash.
///
/// Lifecycle:
///   offer (lender) -> accept (borrower: agrees to terms and referees, gives payout address)
///   -> fund (lender: USDC into this contract)
///   -> confirmLock (both referees: they see the ZEC locked via the vault's viewing key)
///      => principal paid to the borrower, loan Active
///   -> repay (anyone, any number of times; forwarded to the lender) => Repaid when paid in full,
///      or repayAll: every loan of one borrow repaid in full in one transaction
///   or confirmLiquidation (both referees, after the ZEC liquidation) => Liquidated
///   cancel: before funding (lender or borrower), or by the lender once a funded loan's lock
///   deadline passes unconfirmed (the principal goes back to the lender).
contract HypothecLoans {
    enum Status {
        None,
        Offered,
        Accepted,
        Funded,
        Active,
        Repaid,
        Liquidated,
        Cancelled
    }

    struct Loan {
        address lender;
        address borrower;
        address refereeA;
        address refereeB;
        /// Where the lender receives repayments.
        address repayTo;
        /// Where the borrower receives the principal (set at accept).
        address payoutTo;
        uint256 principal;
        /// Principal + interest + fees, fixed at offer.
        uint256 owed;
        uint256 repaid;
        /// Repayment deadline (unix seconds).
        uint64 dueAt;
        /// The referees must confirm the lock by this time, or the lender may take the
        /// funded principal back.
        uint64 lockBy;
        Status status;
        bool lockA;
        bool lockB;
        bool liqA;
        bool liqB;
    }

    /// What the lender offers.
    struct Terms {
        address borrower;
        address refereeA;
        address refereeB;
        address repayTo;
        uint256 principal;
        uint256 owed;
        uint64 dueAt;
        uint64 lockBy;
    }

    IERC20 public immutable usdc;

    /// What each guardian earns per loan: 0.10% of the principal, paid by the lender with
    /// the funding and handed over when both guardians confirm the lock. The same whether
    /// the loan is later repaid or liquidated, so no guardian gains by liquidating.
    uint256 public constant GUARDIAN_FEE_BPS = 10;
    mapping(bytes32 => Loan) private loans;

    event Offered(bytes32 indexed id, address indexed lender, address indexed borrower, uint256 principal, uint256 owed, uint64 dueAt);
    event Accepted(bytes32 indexed id, address payoutTo);
    event Funded(bytes32 indexed id);
    event LockConfirmed(bytes32 indexed id, address indexed referee);
    event Active(bytes32 indexed id, address payoutTo, uint256 principal);
    event Repayment(bytes32 indexed id, address indexed payer, uint256 amount, uint256 repaid);
    event Repaid(bytes32 indexed id);
    event LiquidationConfirmed(bytes32 indexed id, address indexed referee);
    event Liquidated(bytes32 indexed id);
    event Cancelled(bytes32 indexed id, uint256 refunded);
    event GuardianPaid(bytes32 indexed id, address indexed guardian, uint256 fee);

    error WrongStatus(Status status);
    error NotAllowed();
    error BadTerms();
    error TransferFailed();

    constructor(IERC20 usdc_) {
        usdc = usdc_;
    }

    function offer(bytes32 id, Terms calldata t) external {
        if (loans[id].status != Status.None) revert WrongStatus(loans[id].status);
        if (
            t.borrower == address(0) || t.refereeA == address(0) || t.refereeB == address(0)
                || t.repayTo == address(0) || t.refereeA == t.refereeB || t.borrower == msg.sender
                || t.refereeA == msg.sender || t.refereeB == msg.sender || t.refereeA == t.borrower
                || t.refereeB == t.borrower || t.principal == 0 || t.owed < t.principal
                || t.dueAt <= block.timestamp || t.lockBy <= block.timestamp || t.lockBy >= t.dueAt
        ) revert BadTerms();
        Loan storage l = loans[id];
        l.lender = msg.sender;
        l.borrower = t.borrower;
        l.refereeA = t.refereeA;
        l.refereeB = t.refereeB;
        l.repayTo = t.repayTo;
        l.principal = t.principal;
        l.owed = t.owed;
        l.dueAt = t.dueAt;
        l.lockBy = t.lockBy;
        l.status = Status.Offered;
        emit Offered(id, msg.sender, t.borrower, t.principal, t.owed, t.dueAt);
    }

    function getLoan(bytes32 id) external view returns (Loan memory) {
        return loans[id];
    }

    /// The borrower agrees to the terms and both referees, and names the payout address.
    function accept(bytes32 id, address payoutTo) external {
        Loan storage l = loans[id];
        if (l.status != Status.Offered) revert WrongStatus(l.status);
        if (msg.sender != l.borrower) revert NotAllowed();
        if (payoutTo == address(0)) revert BadTerms();
        l.payoutTo = payoutTo;
        l.status = Status.Accepted;
        emit Accepted(id, payoutTo);
    }

    /// One guardian's fee on a principal.
    function guardianFee(uint256 principal) public pure returns (uint256) {
        return (principal * GUARDIAN_FEE_BPS) / 10_000;
    }

    /// What funding a loan takes from the lender: the principal and both guardians' fees.
    function fundingAmount(bytes32 id) public view returns (uint256) {
        return loans[id].principal + 2 * guardianFee(loans[id].principal);
    }

    /// The lender moves the principal and the guardians' fees into this contract (approve
    /// fundingAmount first).
    function fund(bytes32 id) external {
        Loan storage l = loans[id];
        if (l.status != Status.Accepted) revert WrongStatus(l.status);
        if (msg.sender != l.lender) revert NotAllowed();
        l.status = Status.Funded;
        _pull(msg.sender, address(this), fundingAmount(id));
        emit Funded(id);
    }

    /// A referee confirms it sees the collateral locked in the vault. Once both have, the
    /// principal goes to the borrower.
    function confirmLock(bytes32 id) external {
        Loan storage l = loans[id];
        if (l.status != Status.Funded) revert WrongStatus(l.status);
        if (msg.sender == l.refereeA) l.lockA = true;
        else if (msg.sender == l.refereeB) l.lockB = true;
        else revert NotAllowed();
        emit LockConfirmed(id, msg.sender);
        if (l.lockA && l.lockB) {
            l.status = Status.Active;
            uint256 fee = guardianFee(l.principal);
            _send(l.payoutTo, l.principal);
            _send(l.refereeA, fee);
            _send(l.refereeB, fee);
            emit Active(id, l.payoutTo, l.principal);
            emit GuardianPaid(id, l.refereeA, fee);
            emit GuardianPaid(id, l.refereeB, fee);
        }
    }

    /// Anyone may repay (approve this contract first). Forwarded straight to the lender;
    /// anything beyond what is still owed is not taken.
    function repay(bytes32 id, uint256 amount) external {
        Loan storage l = loans[id];
        if (l.status != Status.Active) revert WrongStatus(l.status);
        uint256 left = l.owed - l.repaid;
        if (amount > left) amount = left;
        if (amount == 0) revert BadTerms();
        l.repaid += amount;
        if (l.repaid == l.owed) l.status = Status.Repaid;
        _pull(msg.sender, l.repayTo, amount);
        emit Repayment(id, msg.sender, amount, l.repaid);
        if (l.status == Status.Repaid) emit Repaid(id);
    }

    /// Repays several loans in full in one transaction: what is left on each goes to that
    /// loan's own lender, and each is marked Repaid as `repay` would. The caller approves
    /// this contract for the total first (or uses repayAllWithPermit). All or nothing: if any
    /// loan is not Active (liquidated, released, listed twice), nothing is paid.
    function repayAll(bytes32[] calldata ids) public {
        if (ids.length == 0) revert BadTerms();
        for (uint256 i; i < ids.length; i++) {
            Loan storage l = loans[ids[i]];
            if (l.status != Status.Active) revert WrongStatus(l.status);
            uint256 left = l.owed - l.repaid;
            l.repaid = l.owed;
            l.status = Status.Repaid;
            _pull(msg.sender, l.repayTo, left);
            emit Repayment(ids[i], msg.sender, left, l.repaid);
            emit Repaid(ids[i]);
        }
    }

    /// repayAll after a USDC permit signature, so repaying a whole borrow is one signature
    /// and one transaction. A permit already used (front-run) is not an error if the
    /// allowance it gave is there.
    function repayAllWithPermit(bytes32[] calldata ids, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), value, deadline, v, r, s) {}
        catch {
            if (usdc.allowance(msg.sender, address(this)) < value) revert NotAllowed();
        }
        repayAll(ids);
    }

    /// Both referees record that the collateral was liquidated on Zcash (lender share +
    /// borrower surplus in one transaction), which closes the loan.
    function confirmLiquidation(bytes32 id) external {
        Loan storage l = loans[id];
        if (l.status != Status.Active) revert WrongStatus(l.status);
        if (msg.sender == l.refereeA) l.liqA = true;
        else if (msg.sender == l.refereeB) l.liqB = true;
        else revert NotAllowed();
        emit LiquidationConfirmed(id, msg.sender);
        if (l.liqA && l.liqB) {
            l.status = Status.Liquidated;
            emit Liquidated(id);
        }
    }

    function cancel(bytes32 id) external {
        Loan storage l = loans[id];
        if (l.status == Status.Offered || l.status == Status.Accepted) {
            if (msg.sender != l.lender && msg.sender != l.borrower) revert NotAllowed();
            l.status = Status.Cancelled;
            emit Cancelled(id, 0);
        } else if (l.status == Status.Funded) {
            if (msg.sender != l.lender) revert NotAllowed();
            if (block.timestamp <= l.lockBy) revert WrongStatus(l.status);
            l.status = Status.Cancelled;
            uint256 back = fundingAmount(id);
            _send(l.lender, back);
            emit Cancelled(id, back);
        } else {
            revert WrongStatus(l.status);
        }
    }

    /// True once an active loan is past its deadline and not fully repaid: the referees'
    /// signal that liquidation is allowed on the deadline rule.
    function isOverdue(bytes32 id) external view returns (bool) {
        Loan storage l = loans[id];
        return l.status == Status.Active && block.timestamp > l.dueAt;
    }

    function _pull(address from, address to, uint256 amount) private {
        if (!usdc.transferFrom(from, to, amount)) revert TransferFailed();
    }

    function _send(address to, uint256 amount) private {
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }
}
