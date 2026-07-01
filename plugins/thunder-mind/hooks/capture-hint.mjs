#!/usr/bin/env node
// UserPromptSubmit hook — a model-independent safety net for decision CAPTURE. Scans the user's message
// for decision/convention language (EN + FR) and, only on a match, injects ONE reminder line so a
// convention stated in passing doesn't get lost. Silent (zero output) when there's no match.
//
// Opt-in gate: only speaks in projects that already use thunder-mind (.thunder/mind/ exists). Without
// the gate this hook injected reminders into EVERY repo of every plugin user — against Thunder's
// opt-in rule. First-time adoption goes through /thunder-mind:thunder-mind-record explicitly.
import { existsSync } from 'node:fs';
import { mindDir } from '../engine/lib/cache.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const p = JSON.parse(input || '{}');
  const root = process.env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  if (!existsSync(mindDir(root))) process.exit(0); // project not opted in — stay silent
  const text = String(p.prompt ?? p.user_prompt ?? p.message ?? p.content ?? '');
  // standing-rule / convention cues — kept tight to avoid noise on ordinary requests.
  // FR side requires a VERBAL rule form ("il faut toujours…"), never a bare word like "toujours"
  // ("le build est toujours cassé" must NOT fire).
  const RE = /\b(from now on|going forward|we should always|always (?:use|do|prefer|avoid)|let'?s standardi[sz]e|standardi[sz]e on|the rule is|as a (?:rule|convention)|by convention)\b|à partir de maintenant|désormais|(?:tu devrais|il faut|on doit|nous devons|on devrait) toujours|on standardise|la règle (?:c'est|est)|on décide (?:de|que)|par convention/i;
  if (text && RE.test(text)) {
    process.stdout.write('↳ this sounds like a standing project decision/convention — capture it with '
      + '/thunder-mind:thunder-mind-record so the other developer\'s AI reuses it (not just your own memory).');
  }
} catch { /* never break prompt submission */ }
