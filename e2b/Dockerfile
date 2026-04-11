# OpenHelm Goose sandbox template (unified desktop image).
#
# Base: e2bdev/desktop — Ubuntu 22.04 + XFCE + Xvfb + x11vnc + websockify + noVNC.
# This image is used for BOTH credential setup sessions (where the user VNCs in
# via `sandbox.stream.getUrl()` to log in manually and solve CAPTCHAs) AND normal
# job runs (where Goose drives Chromium through the openhelm-browser MCP with a
# real X display instead of --headless=new).
#
# The Worker writes /tmp/mcp-config.json and /tmp/prompt.txt before launching Goose.
# Goose is then invoked as:
#   cd /workspace && goose run --output-format stream-json \
#     --mcp-config /tmp/mcp-config.json --no-session < /tmp/prompt.txt
#
# Ref: https://github.com/e2b-dev/desktop

FROM e2bdev/desktop

# Prevent interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ── System packages ────────────────────────────────────────────────────────────
# The base image already ships Chromium, Xvfb, XFCE, noVNC, websockify, and Node.
# We add Python 3.12 (for the browser MCP) and a small set of build deps.
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    libssl-dev \
    libffi-dev \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
        python3.12 \
        python3.12-venv \
        python3.12-dev \
        python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Goose ──────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/block/goose/releases/latest/download/goose-linux-amd64 \
        -o /usr/local/bin/goose \
    && chmod +x /usr/local/bin/goose \
    && goose --version

# ── OpenHelm browser MCP server ───────────────────────────────────────────────
COPY mcp-servers/browser/ /opt/openhelm/mcp-servers/browser/

RUN python3.12 -m venv /opt/openhelm/mcp-servers/browser/.venv \
    && /opt/openhelm/mcp-servers/browser/.venv/bin/pip install \
        --no-cache-dir \
        --upgrade pip \
    && /opt/openhelm/mcp-servers/browser/.venv/bin/pip install \
        --no-cache-dir \
        -r /opt/openhelm/mcp-servers/browser/requirements.txt

# ── Persistent browser profile root ────────────────────────────────────────────
# Credential setup sessions create profiles under /home/user/profiles/cred-<id>
# and hydration during job runs untars saved profiles into the same location.
RUN mkdir -p /home/user/profiles /workspace

WORKDIR /workspace

# ── Environment defaults ───────────────────────────────────────────────────────
# Chromium now runs against the real XFCE display exposed by the desktop base
# image, so we drop --headless=new. The display variable is inherited from the
# e2bdev/desktop base (typically :0) — no need to override.
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu"

# Goose provider defaults (overridden per-run by the Worker via env vars)
ENV GOOSE_PROVIDER=anthropic
ENV GOOSE_MODEL=claude-sonnet-4-6

# The e2bdev/desktop base image's CMD starts Xvfb + XFCE + noVNC — keep it.
