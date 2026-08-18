# Shorts Studio ingestion service — Node + yt-dlp + ffmpeg.
FROM node:20-slim

# yt-dlp needs python3 + ffmpeg (for merging video/audio streams). fontconfig +
# a heavy display font (Anton) let ffmpeg's libass burn Hormozi-style captions.
#
# yt-dlp is installed VIA PIP (not the standalone binary) so the bgutil PO-token
# plugin auto-loads from site-packages — the documented, reliable plugin method.
# (The standalone binary + --plugin-dirs did NOT pick the plugin up, so no PO
# token was ever fetched and YouTube kept bot-walling.) The plugin lets yt-dlp
# satisfy YouTube's "proof of origin" check WITHOUT login cookies, pulling a token
# from the companion provider service at YT_DLP_POT_BASE_URL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip python3 python3-pip fontconfig \
  && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" bgutil-ytdlp-pot-provider \
  && mkdir -p /usr/share/fonts/truetype/caption \
  # Canonical raw host — github.com/<owner>/<repo>/raw/... now 403s (GitHub
  # tightened that redirect), which was silently saving an HTML error page as
  # the font. Non-fatal (|| true): if GitHub rate-limits the raw fetch during a
  # build, captions fall back to a default font rather than failing the deploy.
  && (curl -fSL https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf -o /usr/share/fonts/truetype/caption/Anton-Regular.ttf || echo "WARN: Anton font fetch failed; captions will use a fallback font") \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

# Deno — a JavaScript runtime yt-dlp uses to solve YouTube's "n-challenge" (the
# nsig transform). Without a JS runtime, yt-dlp can't unlock the web formats and
# falls back to the tv client's DRM-protected streams ("This video is DRM
# protected"). yt-dlp recommends Deno; it's a single static binary. Installed to
# /usr/local/bin so it's on PATH and yt-dlp's EJS challenge solver auto-detects it.
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
  && unzip /tmp/deno.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/deno \
  && rm /tmp/deno.zip \
  && deno --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
# server.js requires ./render-filters.js at runtime — both must be in the image.
COPY server.js render-filters.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
