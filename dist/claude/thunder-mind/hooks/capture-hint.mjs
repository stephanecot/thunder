#!/usr/bin/env node
// UserPromptSubmit hook — a model-independent safety net for decision CAPTURE. Scans the user's message
// for decision/convention language (EN + FR) and, only on a match, injects ONE reminder line so a
// convention stated in passing doesn't get lost. Silent (zero output) when there's no match.
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const p = JSON.parse(input || '{}');
  const text = String(p.prompt ?? p.user_prompt ?? p.message ?? p.content ?? '');
  // standing-rule / convention cues — kept tight to avoid noise on ordinary requests
  const RE = /\b(from now on|going forward|we should always|always (?:use|do|prefer|avoid)|let'?s standardi[sz]e|standardi[sz]e on|the rule is|as a (?:rule|convention)|by convention)\b|à partir de maintenant|désormais|\btoujours\b|on standardise|la règle (?:c'est|est)|on décide de|par convention/i;
  if (text && RE.test(text)) {
    process.stdout.write('↳ this sounds like a standing project decision/convention — capture it with '
      + '/thunder-mind:thunder-mind-record so the other developer\'s AI reuses it (not just your own memory).');
  }
} catch { /* never break prompt submission */ }
