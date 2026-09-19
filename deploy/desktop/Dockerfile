FROM python:3.13.15-slim@sha256:59d365aafe9c497e90af2caf4affe3e57f677328b251945b0327807887ed3772

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    MPLCONFIGDIR=/data/matplotlib \
    SOLARA_THEME_SHOW_BANNER=false \
    SOLARA_ASSETS_PROXY=true \
    SOLARA_ASSETS_PROXY_CACHE_DIR=/opt/spare/assets/solara-cdn \
    SOLARA_ASSETS_CDN=http://127.0.0.1:1/

WORKDIR /opt/spare
COPY packaging/requirements-linux.lock /tmp/requirements-linux.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements-linux.lock

COPY pyproject.toml ./
COPY src ./src
COPY contracts ./contracts
COPY front ./front
COPY public ./public
COPY exports/project-minimum-001.json exports/project-case-large.json ./exports/
COPY packaging/solara-assets.lock.json ./packaging/solara-assets.lock.json
COPY scripts/prepare-solara-assets.py scripts/initialize-case-database.py ./scripts/
RUN python -m pip install --no-cache-dir --no-deps . \
    && python scripts/prepare-solara-assets.py --destination /opt/spare/assets/solara-cdn \
    && python scripts/prepare-solara-assets.py --destination /opt/spare/assets/solara-cdn --verify \
    && python -m pip check

RUN useradd --create-home --uid 10001 spare \
    && mkdir -p /data /exports /data/matplotlib \
    && chmod -R a+rX /opt/spare \
    && chown -R spare:spare /data /exports
USER spare
