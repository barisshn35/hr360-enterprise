FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Tum Python modullerini al - performance_ml.py gibi ek router'lar
# eklendiginde Dockerfile'i tekrar duzeltmek gerekmesin.
COPY *.py ./
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
