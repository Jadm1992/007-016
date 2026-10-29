# Multi-stage Dockerfile for poc-wreq (Rust Axum + wreq with Chrome TLS emulation)
# Stage 1: Build binary on Alpine with musl and BoringSSL build tools
FROM rust:alpine AS builder

RUN apk add --no-cache \
    musl-dev \
    cmake \
    make \
    g++ \
    perl \
    linux-headers

WORKDIR /app

# Copy dependency files first
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy real source code and build
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Minimal runtime image (~15MB)
FROM alpine:latest AS runtime

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/target/release/poc-wreq /app/poc-wreq

ENV PORT=3000
EXPOSE 3000

CMD ["/app/poc-wreq"]
