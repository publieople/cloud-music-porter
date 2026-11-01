import { normalizeText, artistSet, parseDuration } from './config.js';

const VERSION_WORDS = [
  { key: 'live', re: /live|现场|演唱会|unplugged/i },
  { key: 'remix', re: /remix|混音|dj版|club/i },
  { key: 'instrumental', re: /instrumental|off\s*vocal|伴奏|纯音乐|カラオケ/i },
  { key: 'cover', re: /cover|翻唱|翻自/i },
  { key: 'acoustic', re: /acoustic|不插电/i },
  { key: 'speed', re: /speed\s*up|加速|nightcore/i },
  { key: 'slowed', re: /slowed|减速/i },
];

function versionFlags(text) {
  const flags = new Set();
  for (const item of VERSION_WORDS) if (item.re.test(String(text || ''))) flags.add(item.key);
  return flags;
}

export function scoreCandidate(song, item, options) {
  const opts = options || {};
  const reasons = [];
  let score = 0;
  const songTitle = normalizeText(song.name);
  const itemTitle = normalizeText(item.title);
  if (!itemTitle) return { score: -999, reasons: ['候选没有标题'], title: item.title || '' };
  if (songTitle && itemTitle === songTitle) {
    score += 100;
    reasons.push('标题完全一致 +100');
  } else if (songTitle && (itemTitle.includes(songTitle) || songTitle.includes(itemTitle))) {
    score += 60;
    reasons.push('标题包含 +60');
  } else {
    score -= 40;
    reasons.push('标题不一致 -40');
  }

  const wantedArtists = artistSet(song.artists);
  const itemArtists = artistSet(item.artist);
  let artistHit = 0;
  for (const artist of itemArtists) {
    if (!artist) continue;
    for (const wanted of wantedArtists) {
      if (artist === wanted || artist.includes(wanted) || wanted.includes(artist)) artistHit += 1;
    }
  }
  if (artistHit) {
    score += 40;
    reasons.push('艺人命中 +40');
  } else {
    score -= 10;
    reasons.push('艺人未命中 -10');
  }

  const itemDuration = parseDuration(item.duration);
  const songDuration = Number(song.duration) || 0;
  if (itemDuration && songDuration) {
    const diff = Math.abs(itemDuration - songDuration);
    if (diff <= 2) {
      score += 30;
      reasons.push('时长几乎一致 +30');
    } else if (diff <= 5) {
      score += 12;
      reasons.push('时长接近 +12');
    } else if (diff > 15) {
      score -= 30;
      reasons.push('时长相差 ' + Math.round(diff) + ' 秒 -30');
    }
  }

  const songFlags = versionFlags(song.name);
  const itemFlags = versionFlags(item.title);
  for (const flag of songFlags) if (!itemFlags.has(flag)) { score -= 20; reasons.push('版本差异(' + flag + ') -20'); }
  for (const flag of itemFlags) if (!songFlags.has(flag)) { score -= 20; reasons.push('候选是' + flag + '版本 -20'); }

  if (opts.pluginBonus && opts.pluginBonus[item.pluginPlatform]) {
    score += opts.pluginBonus[item.pluginPlatform];
    reasons.push('插件优先级 +' + opts.pluginBonus[item.pluginPlatform]);
  }
  return { score, reasons, title: item.title, artist: item.artist, duration: itemDuration };
}

export function rankCandidates(song, candidates, options) {
  const opts = options || {};
  return candidates
    .map((item) => ({ item, ...scoreCandidate(song, item, opts) }))
    .sort((a, b) => b.score - a.score);
}

export function pickBest(song, candidates, options) {
  const opts = options || {};
  const minScore = Number(opts.minScore || 75);
  const ranked = rankCandidates(song, candidates, opts).filter((entry) => entry.score >= minScore);
  return ranked.length ? ranked : [];
}

export function candidateLabel(item) {
  return String(item.title || '') + ' - ' + String(item.artist || '') + (item.album ? '《' + item.album + '》' : '');
}
