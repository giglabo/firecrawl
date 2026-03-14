# syntax=docker/dockerfile:1
## Stage 1: Build the native module
FROM node:20-bookworm AS builder

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Configure cargo to use git CLI for fetching (needed for SSH-based private deps)
RUN mkdir -p /root/.cargo && \
    printf '[net]\ngit-fetch-with-cli = true\n' > /root/.cargo/config.toml

# Install git+ssh for private dependencies
RUN apt-get update && apt-get install -y openssh-client git && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy native module source
COPY apps/api/native/Cargo.toml apps/api/native/Cargo.lock* ./apps/api/native/
COPY apps/api/native/src/ ./apps/api/native/src/
COPY apps/api/native/build.rs ./apps/api/native/
COPY apps/api/native/package.json ./apps/api/native/

# Install napi-cli and build (use --mount=type=ssh to forward SSH agent)
RUN npm install -g @napi-rs/cli
WORKDIR /build/apps/api/native
RUN --mount=type=ssh napi build --platform --release

## Stage 2: Runtime — just Node + compiled binary + tests
FROM node:20-bookworm-slim

WORKDIR /test

# Copy compiled native module
COPY --from=builder /build/apps/api/native/*.node ./

# Copy test files and fixtures
COPY apps/api/native/test/test-image-converter.mjs ./test/
COPY apps/api/native/test/fixtures/ ./test/fixtures/

ENV NATIVE_MODULE_PATH=/test/firecrawl_rs.linux-x64-gnu.node

CMD ["node", "test/test-image-converter.mjs"]
