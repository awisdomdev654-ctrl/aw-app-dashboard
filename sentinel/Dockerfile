
# sentinel/Dockerfile
FROM python:3.12-slim
 
WORKDIR /app
 
# Install deps first so this layer is cached unless requirements.txt changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
COPY main.py .
 
# Non-root user — consistent with the backend container
RUN addgroup --system sentinel && adduser --system --ingroup sentinel sentinel
USER sentinel
 
CMD ["python", "-u", "main.py"]
 