FROM python:3.11-slim-bookworm
WORKDIR /app
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements.txt verify_wheels.py ./
RUN pip download --index-url "$PIP_INDEX_URL" --timeout 30 --retries 2 -d /wheels -r requirements.txt && pip download --index-url "$PIP_INDEX_URL" --timeout 30 --retries 2 --no-deps -d /wheels rapidocr-onnxruntime==1.4.4 && python verify_wheels.py && pip install --no-index --find-links=/wheels -r requirements.txt && pip install --no-index --find-links=/wheels --no-deps rapidocr-onnxruntime==1.4.4 && rm -rf /wheels
COPY service.py .
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
USER 65534:65534
EXPOSE 8080
CMD ["python", "service.py"]
