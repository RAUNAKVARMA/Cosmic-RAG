FROM ollama/ollama:latest

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV OLLAMA_MODEL=llama3.2:1b

EXPOSE 11434

ENTRYPOINT ["/entrypoint.sh"]
