import privacyPolicyConfig from '../config/privacy-policy.json' with { type: 'json' };

interface PrivacyPolicy {
  version: string;
  orchestratorUrl: string;
  timeoutMs: number;
  failClosed: boolean;
  enableLocalFallback: boolean;
  redactReplacement: string;
}

interface OrchestratorResponse {
  redactedText: string;
  findings: Array<{ type: string; count: number }>;
  engine: string;
  policyVersion?: string;
}

export interface RedactionResult {
  redactedText: string;
  findings: Array<{ type: string; count: number }>;
  engine: string;
  policyVersion: string;
}

const privacyPolicy: PrivacyPolicy = privacyPolicyConfig;

function compileRegexes() {
  return [
    { type: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: 'phone', regex: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g },
    { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    {
      type: 'credit_card',
      regex: /\b(?:\d[ -]*?){13,16}\b/g,
    },
    {
      type: 'api_key_like',
      regex: /\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{20,}|ghp_[A-Za-z0-9]{20,})\b/g,
    },
    {
      type: 'bearer_token',
      regex: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi,
    },
  ];
}

function maskLike(source: string, fill: string): string {
  return fill.repeat(Math.max(3, source.length));
}

export function redactDeterministic(text: string): RedactionResult {
  let redacted = text;
  const findings: Array<{ type: string; count: number }> = [];

  for (const { type, regex } of compileRegexes()) {
    let count = 0;
    redacted = redacted.replace(regex, (match) => {
      count += 1;
      return maskLike(match, privacyPolicy.redactReplacement);
    });
    if (count > 0) {
      findings.push({ type, count });
    }
  }

  return {
    redactedText: redacted,
    findings,
    engine: 'deterministic-local',
    policyVersion: privacyPolicy.version,
  };
}

async function callOrchestrator(text: string, contentType: string): Promise<RedactionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), privacyPolicy.timeoutMs);
  try {
    const response = await fetch(privacyPolicy.orchestratorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, contentType, policyVersion: privacyPolicy.version }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Privacy orchestrator error: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as OrchestratorResponse;
    if (!payload?.redactedText || !Array.isArray(payload.findings) || !payload.engine) {
      throw new Error('Privacy orchestrator returned malformed payload.');
    }

    return {
      redactedText: payload.redactedText,
      findings: payload.findings,
      engine: payload.engine,
      policyVersion: payload.policyVersion ?? privacyPolicy.version,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function redactWithPolicy(
  text: string,
  contentType = 'text/plain',
): Promise<RedactionResult> {
  if (!text) {
    return {
      redactedText: '',
      findings: [],
      engine: 'none',
      policyVersion: privacyPolicy.version,
    };
  }

  try {
    return await callOrchestrator(text, contentType);
  } catch (error) {
    if (privacyPolicy.enableLocalFallback) {
      return redactDeterministic(text);
    }
    if (privacyPolicy.failClosed) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Privacy redaction blocked by policy: ${message}`);
    }
    return {
      redactedText: text,
      findings: [],
      engine: 'none-bypass',
      policyVersion: privacyPolicy.version,
    };
  }
}