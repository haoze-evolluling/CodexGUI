function messagesOf(timeline) {
  return timeline.filter(item => item?.type === 'message' && item.role !== 'system');
}

function sameMessage(left, right) {
  return left?.role === right?.role && left?.text === right?.text;
}

function isCurrentTranscriptPrefix(sessionTimeline, transcriptTimeline) {
  const sessionMessages = messagesOf(sessionTimeline);
  const transcriptMessages = messagesOf(transcriptTimeline);
  return sessionMessages.length > 0
    && sessionMessages.length <= transcriptMessages.length
    && sessionMessages.every((message, index) => sameMessage(message, transcriptMessages[index]));
}

function mergeMissingActivities(sessionTimeline, transcriptTimeline) {
  const present = new Set(sessionTimeline.map(item => item?.id).filter(Boolean));
  const beforeMessage = new Map();
  let messageCount = 0;
  for (const item of transcriptTimeline) {
    if (item?.type === 'message' && item.role !== 'system') {
      messageCount += 1;
      continue;
    }
    if (!item || item.type === 'message' || present.has(item.id)) continue;
    const bucket = beforeMessage.get(messageCount) || [];
    bucket.push(item);
    beforeMessage.set(messageCount, bucket);
    present.add(item.id);
  }

  const merged = [];
  let seenMessages = 0;
  for (const item of sessionTimeline) {
    if (item?.type === 'message' && item.role !== 'system') {
      merged.push(...(beforeMessage.get(seenMessages) || []));
      seenMessages += 1;
    }
    merged.push(item);
  }
  merged.push(...(beforeMessage.get(seenMessages) || []));
  return merged;
}

function enrichSessionWithCodexTranscript(session, transcript) {
  if (!session || !Array.isArray(session.timeline) || !Array.isArray(transcript?.timeline)) return session;
  // App Server owns the thread state. The append-only JSONL record can only
  // supplement activity that App Server omitted, never replace its messages.
  if (!isCurrentTranscriptPrefix(session.timeline, transcript.timeline)) return session;
  const timeline = mergeMissingActivities(session.timeline, transcript.timeline);
  if (timeline.length === session.timeline.length && (!transcript.tokenUsage || session.tokenUsage)) return session;
  return {
    ...session,
    timeline,
    ...(transcript.tokenUsage && !session.tokenUsage ? { tokenUsage: transcript.tokenUsage } : {}),
  };
}

module.exports = { enrichSessionWithCodexTranscript };
