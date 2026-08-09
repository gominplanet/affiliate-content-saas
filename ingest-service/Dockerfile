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
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip fontconfig \
  && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" bgutil-ytdlp-pot-provider \
  && mkdir -p /usr/share/fonts/truetype/caption \
  && curl -L https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf -o /usr/share/fonts/truetype/caption/Anton-Regular.ttf \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
# server.js requires ./render-filters.js at runtime — both must be in the image.
COPY server.js render-filters.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
