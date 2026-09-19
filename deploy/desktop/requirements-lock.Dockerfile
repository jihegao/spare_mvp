FROM python:3.13.15-slim@sha256:59d365aafe9c497e90af2caf4affe3e57f677328b251945b0327807887ed3772 AS lock
WORKDIR /src
RUN python -m pip install --no-cache-dir pip==25.3 pip-tools==7.5.2
COPY pyproject.toml .
RUN mkdir /out && pip-compile --generate-hashes --strip-extras --output-file /out/requirements-linux.lock pyproject.toml

FROM scratch
COPY --from=lock /out/requirements-linux.lock /
