# Shorts Studio ingestion service — Node + yt-dlp + ffmpeg.
FROM node:20-slim

# yt-dlp needs python3 + ffmpeg (for merging video/audio streams). fontconfig +
# a heavy display font (Anton) let ffmpeg's libass burn Hormozi-style captions.
# python3-pip is added so we can install the bgutil PO-token yt-dlp plugin, which
# lets yt-dlp satisfy YouTube's "proof of origin" bot check WITHOUT login cookies
# (it fetches a token from the companion provider service at YT_DLP_POT_BASE_URL).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip fontconfig \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && pip3 install --no-cache-dir --break-system-packages --target /opt/ytdlp-plugins bgutil-ytdlp-pot-provider \
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
