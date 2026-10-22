# syntax=docker/dockerfile:1.7
# The hosted demo: Hypothec on Zcash testnet and Base Sepolia, in one container.
#   docker build -f deploy/Dockerfile -t hypothec .     (from the repository root, with the
#   vendor/zafe submodule checked out)
# Runs: the zafe relay, the party host (one key-share service per loan and role), the test
# wallet's two key shares, the loanbook and both guardians, and the website with the desk
# agents. State lives on the volume mounted at /data.

# ---------------------------------------------------------------- Rust binaries --
FROM rust:1-bookworm AS rust
# SQLCipher builds a vendored OpenSSL (perl, make); ring needs a C compiler.
RUN apt-get update && apt-get install -y --no-install-recommends perl make clang pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY core core
COPY vendor/zafe vendor/zafe
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release -p hypothec-core --bin hypothec-party \
    && cp target/release/hypothec-party /usr/local/bin/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/vendor/zafe/target \
    cd vendor/zafe && cargo build --release -p zafe-relay \
    && cp target/release/zafe-relay /usr/local/bin/

# ------------------------------------------------- contract ABI, website, services --
FROM node:22-bookworm AS node
WORKDIR /app
# The shielded vault's note library, prover and committed test keys (the website bundles
# them; the contract deploy script uses its Poseidon contracts).
COPY shield/package.json shield/package-lock.json shield/
RUN cd shield && npm ci
COPY shield shield
COPY usdc/package.json usdc/package-lock.json usdc/
RUN cd usdc && npm ci
COPY usdc usdc
RUN cd usdc && npx hardhat compile
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY web web
RUN cd web && node build.mjs
COPY services/package.json services/package-lock.json services/
RUN cd services && npm ci
COPY services services

# --------------------------------------------------------------------- runtime --
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rust /usr/local/bin/hypothec-party /usr/local/bin/zafe-relay /usr/local/bin/
COPY --from=node /app/services services
COPY --from=node /app/web/dist web/dist
COPY --from=node /app/usdc/artifacts usdc/artifacts
COPY usdc/deployments usdc/deployments
COPY e2e/control.py e2e/testnet-wallet.sh e2e/
COPY deploy/start.sh deploy/seed-desks.js deploy/
ENV HOME=/data ZAFE_NETWORK=test HYPOTHEC_PUBLIC=1
EXPOSE 10000
CMD ["bash", "/app/deploy/start.sh"]
