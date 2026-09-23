FROM python:3.12-slim

# Node 22 LTS for checking/executing JS artifacts the agents produce. Debian's
# nodejs is too old for current npm packages (undici needs Node >=20.18/22
# internals), so install the official binary.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
    && curl -fsSL https://nodejs.org/dist/v22.17.0/node-v22.17.0-linux-x64.tar.xz \
       | tar -xJ -C /usr/local --strip-components=1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY exec_server.py /app/exec_server.py

EXPOSE 8080
CMD ["python3", "/app/exec_server.py"]
