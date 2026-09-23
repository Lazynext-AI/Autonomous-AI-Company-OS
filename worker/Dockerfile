FROM python:3.12-slim

# Node for syntax-checking/executing JS artifacts the agents produce.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY exec_server.py /app/exec_server.py

EXPOSE 8080
CMD ["python3", "/app/exec_server.py"]
