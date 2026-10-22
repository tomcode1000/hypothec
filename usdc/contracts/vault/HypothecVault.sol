// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// The shielded dollar vault (TEST BUILD: test proving keys, not audited).
///
/// Zcash's design on an EVM chain: dollars in the vault are private notes. A note's
/// commitment Poseidon(amount, owner, blinding) is a leaf in this contract's Merkle tree; it
/// is spent by a zero-knowledge proof (shield/circuits/spend.circom) that shows the spender
/// knows a note in the tree without saying which, and publishes its nullifier so it cannot be
/// spent twice. Who holds what, and which deposit a spend came from, stay private.
///
/// In: `deposit` (anyone, from a wallet; and the loan contract, paying a shielded loan out).
/// Out: `transact`, with a proof: release an amount to a wallet, repay a loan with it, or fund
/// a private desk's loan with it, and keep the rest as a new note. A relayer may submit it, so the spender's wallet never shows.
interface IERC20V {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address who) external view returns (uint256);
}

interface IPoseidon2 {
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);
}

interface IPoseidon3 {
    function poseidon(uint256[3] calldata inputs) external pure returns (uint256);
}

interface ISpendVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[6] calldata signals) external view returns (bool);
}

interface ILoansRepay {
    function repay(bytes32 id, uint256 amount) external;
    function fundFromVault(bytes32 id) external;
}

contract HypothecVault {
    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant LEVELS = 20;
    uint256 public constant ROOTS = 30;

    IERC20V public immutable token;
    ISpendVerifier public immutable verifier;
    IPoseidon2 public immutable poseidon2;
    IPoseidon3 public immutable poseidon3;
    /// The loan contract a spend may repay (set once, after both are deployed).
    address public loans;
    address private immutable deployer;

    uint256[LEVELS + 1] public zeros;
    uint256[LEVELS] private filled;
    uint256[ROOTS] public roots;
    uint256 public rootIndex;
    uint256 public nextIndex;
    mapping(uint256 => bool) public spent;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    /// What a spend does outside the vault; its hash is a public input of the proof.
    struct ExtData {
        address recipient;
        bytes32 loanId;
        address relayer;
        uint256 fee;
    }

    event NewCommitment(uint256 commitment, uint256 index);
    event NewNullifier(uint256 nullifier);
    event Shielded(address indexed from, uint256 amount);
    event Released(address indexed to, bytes32 indexed loanId, uint256 amount);

    error BadInput();
    error UnknownRoot();
    error Spent();
    error BadProof();
    error TransferFailed();

    constructor(IERC20V token_, ISpendVerifier verifier_, IPoseidon2 p2, IPoseidon3 p3) {
        token = token_;
        verifier = verifier_;
        poseidon2 = p2;
        poseidon3 = p3;
        deployer = msg.sender;
        zeros[0] = 0;
        for (uint256 i = 0; i < LEVELS; i++) {
            filled[i] = zeros[i];
            zeros[i + 1] = p2.poseidon([zeros[i], zeros[i]]);
        }
        roots[0] = zeros[LEVELS];
    }

    function setLoans(address loans_) external {
        if (msg.sender != deployer || loans != address(0) || loans_ == address(0)) revert BadInput();
        loans = loans_;
    }

    /// Puts `amount` into the vault as the note Poseidon(amount, owner, blinding), paid by the
    /// caller (approve first). The owner and blinding are public here; only the note's secret
    /// (behind `owner`) can spend it, and every note has its own.
    function deposit(uint256 amount, uint256 owner, uint256 blinding) external returns (uint256 commitment) {
        if (amount == 0 || amount >= 2 ** 64 || owner >= FIELD || blinding >= FIELD) revert BadInput();
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        commitment = poseidon3.poseidon([amount, owner, blinding]);
        _insert(commitment);
        emit Shielded(msg.sender, amount);
    }

    /// Spends one or two notes with a proof: `publicAmount` leaves the vault (less the relayer's
    /// fee) to `ext.recipient`; or, with `ext.loanId`, repays that loan (recipient zero) or funds
    /// it (recipient the loan contract: a private desk funding its loan). The rest is the new note.
    function transact(
        Proof calldata p,
        uint256 root,
        uint256 publicAmount,
        uint256[2] calldata nullifiers,
        uint256 outCommitment,
        ExtData calldata ext
    ) external {
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (spent[nullifiers[0]] || spent[nullifiers[1]]) revert Spent();
        if (ext.fee > publicAmount || outCommitment >= FIELD) revert BadInput();
        uint256 extHash = uint256(keccak256(abi.encode(ext))) % FIELD;
        uint256[6] memory signals = [root, publicAmount, extHash, nullifiers[0], nullifiers[1], outCommitment];
        if (!verifier.verifyProof(p.a, p.b, p.c, signals)) revert BadProof();

        spent[nullifiers[0]] = true;
        spent[nullifiers[1]] = true;
        emit NewNullifier(nullifiers[0]);
        emit NewNullifier(nullifiers[1]);
        _insert(outCommitment);

        uint256 amount = publicAmount - ext.fee;
        if (ext.fee > 0 && !token.transfer(ext.relayer, ext.fee)) revert TransferFailed();
        if (amount == 0) return;
        if (ext.loanId != bytes32(0)) {
            // Repay or fund that loan with exactly `amount`: the loan contract pulls it from
            // here, and must use the whole approval (a repayment may come straight back in as
            // a private desk's note, so the balance is no measure).
            if (ext.recipient != address(0) && ext.recipient != loans) revert BadInput();
            if (!token.approve(loans, amount)) revert TransferFailed();
            if (ext.recipient == loans) ILoansRepay(loans).fundFromVault(ext.loanId);
            else ILoansRepay(loans).repay(ext.loanId, amount);
            if (token.allowance(address(this), loans) != 0) revert BadInput();
            emit Released(loans, ext.loanId, amount);
        } else {
            if (ext.recipient == address(0)) revert BadInput();
            if (!token.transfer(ext.recipient, amount)) revert TransferFailed();
            emit Released(ext.recipient, bytes32(0), amount);
        }
    }

    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        for (uint256 i = 0; i < ROOTS; i++) if (roots[i] == root) return true;
        return false;
    }

    function currentRoot() external view returns (uint256) {
        return roots[rootIndex];
    }

    function _insert(uint256 leaf) private {
        uint256 index = nextIndex;
        if (index >= 2 ** LEVELS) revert BadInput();
        uint256 cur = leaf;
        uint256 i = index;
        for (uint256 l = 0; l < LEVELS; l++) {
            if (i % 2 == 0) {
                filled[l] = cur;
                cur = poseidon2.poseidon([cur, zeros[l]]);
            } else {
                cur = poseidon2.poseidon([filled[l], cur]);
            }
            i /= 2;
        }
        rootIndex = (rootIndex + 1) % ROOTS;
        roots[rootIndex] = cur;
        nextIndex = index + 1;
        emit NewCommitment(leaf, index);
    }
}
