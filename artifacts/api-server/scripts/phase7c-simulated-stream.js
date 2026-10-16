export function envelope(result) {
  return {
    id: 'simulated-only',
    status: 'completed',
    model: 'simulated-only',
    service_tier: 'simulated',
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
  };
}
export function event(type, fields = {}, newline = '\n') {
  return `event: ${type}${newline}data: ${JSON.stringify({ type, ...fields })}${newline}${newline}`;
}
export function streamText(result, completed = true, newline = '\n') {
  const text = JSON.stringify(result);
  let s =
    `: deterministic simulation${newline}${newline}` +
    event('response.created', { response: { status: 'in_progress' } }, newline);
  for (let i = 0; i < text.length; i += 67)
    s += event(
      'response.output_text.delta',
      { output_index: 0, content_index: 0, delta: text.slice(i, i + 67) },
      newline,
    );
  if (completed) s += event('response.completed', { response: envelope(result) }, newline);
  return s;
}
export function simulatedResponse(text, options = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      async pull(controller) {
        if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        if (offset >= bytes.length) {
          if (options.fault) controller.error(new Error('simulated disconnect'));
          else controller.close();
          return;
        }
        const end = Math.min(bytes.length, offset + (options.chunkSize ?? bytes.length));
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
