pragma circom 2.1.0;

// The shielded dollar vault's one circuit (Zcash's design, small): spend up to two notes,
// make one change note, release a public amount (to repay a loan or to withdraw).
//
// A note is   commitment = Poseidon(amount, owner, blinding),  owner = Poseidon(secret).
// Its nullifier is Poseidon(secret, blinding): published when the note is spent, so it
// cannot be spent twice, and nobody without the secret can tell which note it was.
//
// Public:  root, publicAmount, extDataHash, inputNullifier[2], outputCommitment.
// Private: the notes being spent (amount, secret, blinding, Merkle path) and the change note.
// An unused input has amount 0; its Merkle path is not checked.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    signal cur[levels + 1];
    signal left[levels];
    signal right[levels];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        // 0: this node is the left child; 1: the right.
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        left[i] <== cur[i] + pathIndices[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (cur[i] - pathElements[i]);
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

template Spend(levels) {
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input inputNullifier[2];
    signal input outputCommitment;

    signal input inAmount[2];
    signal input inSecret[2];
    signal input inBlinding[2];
    signal input inPathElements[2][levels];
    signal input inPathIndices[2][levels];

    signal input outAmount;
    signal input outOwner;
    signal input outBlinding;

    component owner[2];
    component commit[2];
    component nul[2];
    component tree[2];
    component rootOk[2];
    component inRange[2];

    for (var i = 0; i < 2; i++) {
        inRange[i] = Num2Bits(64);
        inRange[i].in <== inAmount[i];

        owner[i] = Poseidon(1);
        owner[i].inputs[0] <== inSecret[i];

        commit[i] = Poseidon(3);
        commit[i].inputs[0] <== inAmount[i];
        commit[i].inputs[1] <== owner[i].out;
        commit[i].inputs[2] <== inBlinding[i];

        nul[i] = Poseidon(2);
        nul[i].inputs[0] <== inSecret[i];
        nul[i].inputs[1] <== inBlinding[i];
        nul[i].out === inputNullifier[i];

        tree[i] = MerkleRoot(levels);
        tree[i].leaf <== commit[i].out;
        for (var j = 0; j < levels; j++) {
            tree[i].pathElements[j] <== inPathElements[i][j];
            tree[i].pathIndices[j] <== inPathIndices[i][j];
        }
        // A real note (amount > 0) must be in the tree; an empty input is not checked.
        rootOk[i] = ForceEqualIfEnabled();
        rootOk[i].enabled <== inAmount[i];
        rootOk[i].in[0] <== root;
        rootOk[i].in[1] <== tree[i].root;
    }

    // The two nullifiers differ, so one note cannot be spent twice in one proof.
    component same = IsEqual();
    same.in[0] <== inputNullifier[0];
    same.in[1] <== inputNullifier[1];
    same.out === 0;

    component outRange = Num2Bits(64);
    outRange.in <== outAmount;
    component pubRange = Num2Bits(64);
    pubRange.in <== publicAmount;

    component outCommit = Poseidon(3);
    outCommit.inputs[0] <== outAmount;
    outCommit.inputs[1] <== outOwner;
    outCommit.inputs[2] <== outBlinding;
    outCommit.out === outputCommitment;

    // Nothing is created: what goes in comes out, as change or released.
    inAmount[0] + inAmount[1] === outAmount + publicAmount;

    // Bind the transaction's details (recipient, loan, relayer, fee) to the proof.
    signal extSquare;
    extSquare <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, inputNullifier, outputCommitment]} = Spend(20);
