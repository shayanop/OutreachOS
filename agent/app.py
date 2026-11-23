from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

app = FastAPI(title="GrowthPilot API")


@app.get("/health", response_class=PlainTextResponse)
def health() -> str:
    return "ok"
