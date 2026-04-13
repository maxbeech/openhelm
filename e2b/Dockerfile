# OpenHelm Goose sandbox template — unified desktop image.
#
# This ONE image is used for:
#   1. Credential setup sessions — the Worker spawns it via @e2b/desktop and
#      streams the XFCE display back to the frontend iframe so the user can
#      log in manually / solve CAPTCHAs inside the sandbox.
#   2. Normal scheduled runs — Goose drives Chromium through openhelm-browser
#      MCP against the SAME XFCE display (no --headless=new). The same
#      sandbox.stream.getUrl() mechanism can be used later for live
#      "watch the agent work" views.
#
# The @e2b/desktop SDK at runtime:
#   - Spawns Xvfb :0 via `commands.run("Xvfb :0 -ac ...", background: true)`
#   - Waits for `xdpyinfo -display :0` to succeed
#   - Runs `startxfce4` in the background
#   - On stream.start():   `x11vnc -bg -display :0 ... -rfbport 5900`
#   - On stream.start():   `cd /opt/noVNC/utils && ./novnc_proxy --vnc localhost:5900 --listen 6080 --web /opt/noVNC`
#
# So the template must provide: Xvfb, xdpyinfo, xfce4 + startxfce4, x11vnc,
# /opt/noVNC (the e2b-desktop fork), /opt/noVNC/utils/websockify v0.12.0,
# scrot + xdotool for screenshots/mouse/keyboard, chromium for the user, and
# everything Goose + the openhelm-browser MCP need.
#
# Ref for SDK runtime commands: @e2b/desktop package, VNCServer class.
# Ref for desktop template setup: https://github.com/e2b-dev/desktop/blob/main/template/template.py

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBIAN_PRIORITY=high
ENV TZ=UTC
ENV PIP_DEFAULT_TIMEOUT=100
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_NO_CACHE_DIR=1

# ── Core build / network / add-apt-repository deps ────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        gnupg \
        lsb-release \
        sudo \
        software-properties-common \
        apt-transport-https \
        build-essential \
        libssl-dev \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Python 3.12 (for the openhelm-browser MCP) ────────────────────────────────
RUN add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.12 \
        python3.12-venv \
        python3.12-dev \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

# ── Desktop stack: Xvfb, XFCE, x11vnc, xdotool, scrot ─────────────────────────
# These match the packages in e2b-dev/desktop's template.py so the SDK's
# runtime commands (Xvfb, xdpyinfo, startxfce4, x11vnc, scrot, xdotool) all
# resolve on PATH. libgtk-3-bin is pulled in because xfce4-goodies wants it.
RUN apt-get update && apt-get install -y --no-install-recommends \
        xserver-xorg \
        xvfb \
        x11-xserver-utils \
        x11-utils \
        xauth \
        xfce4 \
        xfce4-goodies \
        x11vnc \
        xdotool \
        scrot \
        net-tools \
        libgtk-3-bin \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome (real deb, not the snap-transition stub) ────────────────────
# Ubuntu 22.04's `chromium-browser` apt package is a snap shim that errors with
# "requires the chromium snap to be installed" inside sandboxed containers
# where snapd doesn't run. Google Chrome ships a real .deb that works standalone.
# This is the same approach e2b-dev/desktop's template.py uses.
RUN wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# ── noVNC (e2b-dev fork) + websockify 0.12.0 ──────────────────────────────────
# The @e2b/desktop SDK hard-codes these paths in its novncCommand:
#   cd /opt/noVNC/utils && ./novnc_proxy --vnc localhost:5900 --listen <port> --web /opt/noVNC
# So we MUST lay them out exactly this way. The e2b-dev fork ships
# novnc_proxy in utils/ and patches for the display sizing.
RUN git clone --depth 1 --branch e2b-desktop https://github.com/e2b-dev/noVNC.git /opt/noVNC \
    && ln -sf /opt/noVNC/vnc.html /opt/noVNC/index.html \
    && git clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify

# ── Node.js 20 (for future data-tables MCP / Node tooling) ────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Goose ──────────────────────────────────────────────────────────────────────
# block/goose publishes Linux binaries as tar.bz2, not raw binaries — the
# release asset name is `goose-x86_64-unknown-linux-gnu.tar.bz2`.
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/block/goose/releases/latest/download/goose-x86_64-unknown-linux-gnu.tar.bz2 \
        -o /tmp/goose.tar.bz2 \
    && tar -xjf /tmp/goose.tar.bz2 -C /usr/local/bin/ \
    && rm /tmp/goose.tar.bz2 \
    && chmod +x /usr/local/bin/goose \
    && goose --version

# ── openhelm-browser MCP server ───────────────────────────────────────────────
# build.sh copies agent/mcp-servers/ → e2b/mcp-servers/ before the build so
# this COPY resolves in the build context.
COPY mcp-servers/browser/ /opt/openhelm/mcp-servers/browser/
RUN python3.12 -m venv /opt/openhelm/mcp-servers/browser/.venv \
    && /opt/openhelm/mcp-servers/browser/.venv/bin/pip install --upgrade pip \
    && /opt/openhelm/mcp-servers/browser/.venv/bin/pip install \
        -r /opt/openhelm/mcp-servers/browser/requirements.txt

# ── Persistent browser profile root ────────────────────────────────────────────
# Credential setup sessions create /home/user/profiles/cred-<id> here, and
# run-time hydration (worker/src/profile-hydration.ts) untars saved profiles
# back into the same location for every subsequent run.
RUN mkdir -p /home/user/profiles /workspace \
    && chmod 755 /home/user /home/user/profiles /workspace

WORKDIR /workspace

# ── Environment defaults ───────────────────────────────────────────────────────
# Chromium runs against the real XFCE display (no --headless=new). The SDK
# sets DISPLAY=:0 via env when it spawns Xvfb, so we don't hard-code it here.
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu"
ENV GOOSE_PROVIDER=openrouter
ENV GOOSE_MODEL=openai/gpt-4o
