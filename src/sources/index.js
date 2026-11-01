import { loadConfig } from '../core/config.js';
import { rankCandidates, candidateLabel } from '../core/matcher.js';
import { probeLxSources, lxPlatformForPlugin, guessLxPlatform, buildLxMusicInfo, lxSourceLabel } from './lx.js';
import { listMusicFreePlugins, searchAllPlugins, resolveMusicFreeItem } from './musicfree.js';

const PLATFORM_NAMES = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };

export class SourceManager {
  constructor(config) {
    this.config = config || loadConfig();
    this.state = {
      lx: { dir: '', sources: [], error: '', enabled: this.config.sourceMode !== 'musicfree' },
      // 搜索能力只来自 MusicFree 插件（LX 自定义源只提供「解析播放地址」，没有搜索接口），
      // 所以无论 sourceMode 是什么都要加载 MusicFree 插件；sourceMode 只决定「解析」用谁。
      musicfree: { dir: '', plugins: [], error: '', enabled: true, resolve: this.config.sourceMode !== 'lx' },
    };
  }

  async init() {
    if (this.state.lx.enabled) {
      try {
        const result = await probeLxSources({ dataDir: this.config.lxDataDir || '', timeoutMs: this.config.searchTimeoutMs });
        this.state.lx.dir = result.dir;
        this.state.lx.sources = (result.sources || []).filter((entry) => entry.ok);
        this.state.lx.error = result.error || '';
        if (!result.dir) this.state.lx.error = result.error || '没有找到 LX Music 数据目录';
      } catch (error) {
        this.state.lx.error = '加载 LX Music 自定义源失败：' + String(error.message || error);
      }
    }
    if (this.state.musicfree.enabled) {
      try {
        const result = listMusicFreePlugins({ dir: this.config.musicFreePluginsDir || '' });
        this.state.musicfree.dir = result.dir;
        this.state.musicfree.plugins = result.plugins || [];
        if (!result.dir) this.state.musicfree.error = '没有找到 MusicFree 插件目录（搜索候选需要它，见 README「音源」一节）';
      } catch (error) {
        this.state.musicfree.error = '加载 MusicFree 插件失败：' + String(error.message || error);
      }
    }
    return this;
  }

  lxPlatforms() {
    const platforms = new Set();
    for (const source of this.state.lx.sources) {
      for (const platform of source.platforms || []) platforms.add(platform.key);
    }
    return platforms;
  }

  describe() {
    return {
      sourceMode: this.config.sourceMode,
      lx: {
        enabled: this.state.lx.enabled,
        dir: this.state.lx.dir,
        error: this.state.lx.error,
        sources: this.state.lx.sources.map((entry) => ({
          name: entry.name,
          version: entry.version,
          author: entry.author,
          platforms: (entry.platforms || []).map((platform) => ({ key: platform.key, name: platform.name || PLATFORM_NAMES[platform.key] || platform.key, qualitys: platform.qualitys })),
        })),
      },
      musicfree: {
        enabled: this.state.musicfree.enabled,
        resolveEnabled: this.state.musicfree.resolve,
        dir: this.state.musicfree.dir,
        error: this.state.musicfree.error,
        plugins: this.state.musicfree.plugins.map((entry) => ({ platform: entry.platform, version: entry.version, fileName: entry.fileName, ok: entry.ok, error: entry.error })),
      },
    };
  }

  available() {
    return this.searchPlugins().length > 0;
  }

  searchPlugins() {
    return this.state.musicfree.plugins.filter((entry) => entry.ok && entry.plugin);
  }

  async search(song, options) {
    const opts = options || {};
    const plugins = this.searchPlugins();
    if (!plugins.length) return [];
    const query = [song.name].concat((song.artists || []).slice(0, 1)).join(' ');
    const raw = await searchAllPlugins(plugins, query, {
      timeoutMs: this.config.searchTimeoutMs,
      concurrency: this.config.pluginConcurrency,
    });
    const unique = [];
    const seen = new Set();
    for (const item of raw) {
      const key = [String(item.title || '').toLowerCase(), String(item.artist || '').toLowerCase(), Math.round(Number(item.duration) || 0)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    const ranked = rankCandidates(song, unique, {});
    const limit = Number(opts.limit || 10);
    const minScore = Number(opts.minScore === undefined ? 40 : opts.minScore);
    return ranked
      .filter((entry) => entry.score >= minScore)
      .slice(0, limit)
      .map((entry) => ({
        item: entry.item,
        score: entry.score,
        reasons: entry.reasons,
        label: candidateLabel(entry.item),
        pluginPlatform: entry.item.pluginPlatform,
        duration: entry.item.duration,
      }));
  }

  async resolve(song, candidate, options) {
    const opts = options || {};
    const quality = opts.quality || this.config.quality || 'flac';
    const mode = opts.mode || this.config.sourceMode || 'auto';
    const item = candidate.item || candidate;
    const errors = [];
    const mapped = lxPlatformForPlugin(candidate.pluginPlatform || item.pluginPlatform) || guessLxPlatform(item);
    const platforms = this.lxPlatforms();

    if (mode !== 'musicfree' && mapped && platforms.has(mapped)) {
      for (const source of this.state.lx.sources) {
        const supports = (source.platforms || []).some((platform) => platform.key === mapped);
        if (!supports) continue;
        try {
          const musicInfo = buildLxMusicInfo(mapped, item, song, quality);
          const resolved = await source.runtime.resolve(mapped, musicInfo, quality, this.config.resolveTimeoutMs);
          return {
            url: resolved.url,
            quality: resolved.quality,
            source: 'lx',
            sourceLabel: lxSourceLabel(source) + ' / ' + (PLATFORM_NAMES[mapped] || mapped),
            lxPlatform: mapped,
            lxSourceName: source.name,
            headers: {},
          };
        } catch (error) {
          errors.push('LX「' + source.name + '」：' + String(error.message || error).slice(0, 120));
        }
      }
    } else if (mode !== 'musicfree' && mapped && !platforms.has(mapped)) {
      errors.push('LX 源不支持平台 ' + (PLATFORM_NAMES[mapped] || mapped));
    } else if (mode === 'lx' && !mapped) {
      errors.push('sourceMode=lx 时只允许用 LX 源解析，但这个候选无法映射到 LX 平台');
    }

    if (mode !== 'lx') {
      try {
        const resolved = await resolveMusicFreeItem(item, { quality, timeoutMs: this.config.resolveTimeoutMs });
        return {
          url: resolved.url,
          quality: resolved.quality,
          source: 'musicfree',
          sourceLabel: 'MusicFree / ' + (candidate.pluginPlatform || item.pluginPlatform || '未知插件'),
          headers: resolved.headers || {},
          pluginPlatform: candidate.pluginPlatform || item.pluginPlatform,
        };
      } catch (error) {
        errors.push('MusicFree：' + String(error.message || error).slice(0, 120));
      }
    }
    const error = new Error('没有可用的音源解析结果：' + errors.join('；'));
    error.errors = errors;
    throw error;
  }
}

export async function createSourceManager(config) {
  const manager = new SourceManager(config || loadConfig());
  await manager.init();
  return manager;
}

export { candidateLabel };
