# core: hypothec-party

One party (Borrower, Lender or Referee) of a 2-of-3 shielded loan vault. Each party runs its
own copy, which holds only that party's FROST key share. Parties talk through zafe's blind
relay (encrypted envelopes; the relay holds no keys and cannot spend).

Built on zafe-core (MIT OR Apache-2.0, Anmol Bansal and Zafe contributors), vendored in
`../vendor/zafe` with `../spike/zafe-multi-output.patch`. Development only: state is plain
files in `--home`, and the API has no authentication, so it listens on localhost.

## API (JSON)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | /identity | | `identity` |
| POST | /vault/create | `name, threshold, members` | `invite` |
| POST | /vault/join | `invite` | `joined` |
| POST | /vault/seal | | `sealed` |
| GET | /vault/members | | `members, sealed, safety_number` |
| POST | /vault/keygen | `safety_number, birthday?` | `address` (all parties call at once) |
| GET | /vault | | `name, threshold, members, address, ufvk, birthday` |
| GET | /balance | | `height, spendable_zat, ironwood_zat, total_zat` |
| POST | /spends | `outputs: [{address, amount_zat}], memo?` | `id` |
| GET | /spends | | `spends: [{id, status, outputs, approvals, ...}]` |
| POST | /spends/{id}/approve | | `outputs, fee_zat, change_zat, signed, complete` |
| POST | /spends/{id}/send | | `txid` |

Errors: status 400, `{"error": "..."}`.

`approve` rebuilds and checks the transaction itself before signing. The referee's rules
(surplus to the borrower's registered address, release only to that address) belong in
front of this call, in `referee/`.

## hypothec-watch

Balance from a viewing key alone (cannot spend): for an auditor given the vault's `ufvk`
(from `GET /vault`), or to confirm a payout arrived.

```bash
hypothec-watch --ufvk <uview...> --birthday <height> --home <cache dir>
# {"height":121,"ironwood_zat":0,"spendable_zat":0,"total_zat":0}
```

## Build and test (WSL Ubuntu)

```bash
source ~/hypothec-build/env.sh
cd "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec"
CARGO_TARGET_DIR=~/hypothec-build/target-hypothec cargo build -p hypothec-core
core/e2e/run.sh     # builds, then runs e2e/liquidation.sh on a fresh regtest chain
```

First build: about 16 minutes. `e2e/liquidation.sh` runs the product's vault shape
(3-of-4, docs/DECISIONS.md D4) through this API: four services, DKG, 10 ZEC locked, one
spend paying lender share + borrower surplus; Lender + one referee is refused; Lender + both
referees sign; the Borrower does not; the vault ends at 0. `hypothec-watch` confirms an
outsider with the vault's viewing key sees 10 ZEC then 0, and that the two recipients
received exactly the lender share + surplus. If `ths` fails to start in time (happened once
on 8 Oct), rerun.
