import os
import re
from typing import Dict, List

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="privacy-orchestrator", version="1.0.0")

VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://vllm:8000/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "mistralai/Mistral-7B-Instruct-v0.2")
USE_CREWAI_SWARM = os.getenv("USE_CREWAI_SWARM", "1") == "1"


class RedactRequest(BaseModel):
    text: str
    contentType: str = "text/plain"
    policyVersion: str = "1.0.0"


class Finding(BaseModel):
    type: str
    count: int


class RedactResponse(BaseModel):
    redactedText: str
    findings: List[Finding]
    engine: str
    policyVersion: str


def _mask(value: str, fill: str = "█") -> str:
    return fill * max(3, len(value))


def redact_deterministic(text: str) -> Dict:
    patterns = [
        ("email", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
        (
            "phone",
            re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b"),
        ),
        ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
        ("credit_card", re.compile(r"\b(?:\d[ -]*?){13,16}\b")),
        (
            "api_key_like",
            re.compile(r"\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{20,}|ghp_[A-Za-z0-9]{20,})\b"),
        ),
        ("bearer_token", re.compile(r"\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b", re.I)),
    ]

    redacted = text
    findings = []
    for name, pattern in patterns:
        count = 0

        def replace(m):
            nonlocal count
            count += 1
            return _mask(m.group(0))

        redacted = pattern.sub(replace, redacted)
        if count:
            findings.append({"type": name, "count": count})

    return {"redactedText": redacted, "findings": findings, "engine": "deterministic-local"}


async def _vllm_redact_prompt(text: str) -> str:
    prompt = (
        "Redact any sensitive personal or secret data from the following text. "
        "Replace sensitive spans with block characters. "
        "Return only the redacted text and nothing else.\n\n"
        f"TEXT:\n{text}"
    )
    payload = {
        "model": VLLM_MODEL,
        "messages": [
            {"role": "system", "content": "You are a strict privacy redaction engine."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(f"{VLLM_BASE_URL}/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()

    return data["choices"][0]["message"]["content"].strip()


async def redact_with_swarm(text: str) -> Dict:
    # Deterministic base pass remains mandatory and acts as guardrail.
    base = redact_deterministic(text)

    if not USE_CREWAI_SWARM:
        return base

    try:
        # In this baseline implementation, vLLM refines the already-redacted text.
        refined = await _vllm_redact_prompt(base["redactedText"])
        second_pass = redact_deterministic(refined)
        second_pass["engine"] = "crewai-swarm-vllm+deterministic"
        return second_pass
    except Exception:
        # Fail safe to deterministic-only if local model path is unavailable.
        return base


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/redact", response_model=RedactResponse)
async def redact(request: RedactRequest) -> RedactResponse:
    if not request.text:
        return RedactResponse(
            redactedText="",
            findings=[],
            engine="none",
            policyVersion=request.policyVersion,
        )

    try:
        result = await redact_with_swarm(request.text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"redaction failed: {exc}") from exc

    return RedactResponse(
        redactedText=result["redactedText"],
        findings=[Finding(**f) for f in result["findings"]],
        engine=result["engine"],
        policyVersion=request.policyVersion,
    )
