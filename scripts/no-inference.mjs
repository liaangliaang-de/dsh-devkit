// Test-only root: even an accidental auxiliary invocation may not consume model quota.
export function apply(ctx){
 ctx.on('llm/stream',async function*(){throw new Error('Native integration test forbids all model inference');},{prepend:true});
}
