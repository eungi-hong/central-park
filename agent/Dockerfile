FROM python:3.12-slim

WORKDIR /app

# Install deps first for better layer caching
COPY src/python/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy the package
COPY src/python/central_park /app/central_park

# Non-root user
RUN useradd --create-home --shell /bin/bash agent && chown -R agent:agent /app
USER agent

EXPOSE 8000
CMD ["uvicorn", "central_park.main:app", "--host", "0.0.0.0", "--port", "8000"]
