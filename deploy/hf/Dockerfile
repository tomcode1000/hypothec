# The hosted demo on a Hugging Face Space (Docker): the same image as deploy/Dockerfile,
# built by GitHub Actions and pulled from ghcr.io, on the port Spaces expect.
FROM ghcr.io/tomcode1000/hypothec:latest
USER root
# Spaces run the container as user 1000: give it a writable home for the state.
RUN mkdir -p /data && chmod 777 /data
COPY start.sh /app/deploy/space-start.sh
ENV PORT=7860 HOME=/data
EXPOSE 7860
CMD ["bash", "/app/deploy/space-start.sh"]
