(() => {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  // Form & inputs
  const form = $('#urlForm');
  const urlInput = $('#urlInput');
  const embedInput = $('#embedInput');
  const urlContainer = $('#urlInputContainer');
  const embedContainer = $('#embedInputContainer');
  const modeUrlBtn = $('#modeUrlBtn');
  const modeEmbedBtn = $('#modeEmbedBtn');
  const fetchBtn = $('#fetchBtn');
  const fetchBtnText = $('#fetchBtnText');
  const fetchBtnIcon = $('#fetchBtnIcon');

  // Display states
  const idleTags = $('#idleTags');
  const errorBox = $('#errorBox');
  const inputError = $('#inputError');
  const analyzingBox = $('#analyzingBox');
  const analyzingText = $('#analyzingText');
  const readyBox = $('#readyBox');

  // Source info card elements
  const sourceIconBox = $('#sourceIconBox');
  const sourceBadge = $('#sourceBadge');
  const sourceTitle = $('#sourceTitle');
  const sourceUrl = $('#sourceUrl');
  const sourcePlatformDetails = $('#sourcePlatformDetails');
  const sourceFileSize = $('#sourceFileSize');

  // Preview, progress & actions
  const videoPreviewWrap = $('#videoPreviewWrap');
  const videoPreview = $('#videoPreview');
  const progressWrap = $('#progressWrap');
  const progressBar = $('#progressBar');
  const progressPercent = $('#progressPercent');
  const doneBox = $('#doneBox');
  const downloadActionBtn = $('#downloadActionBtn');
  const downloadActionText = $('#downloadActionText');
  const resetActionBtn = $('#resetActionBtn');

  // Multi-item results
  const results = $('#results');
  const grid = $('#mediaGrid');
  const resultSubtitle = $('#resultSubtitle');
  const resultsEmpty = $('#resultsEmpty');
  const downloadSelectedBtn = $('#downloadSelected');
  const selectedCountEl = $('#selectedCount');

  // Toast
  const toast = $('#toast');
  const toastMessage = $('#toastMessage');

  let currentMode = 'url';
  let currentState = 'idle'; // idle | analyzing | ready | downloading | done | error
  let detectedSource = null;
  let activeFilter = 'all';
  let cards = [];
  let toastTimer;
  let progressInterval = null;
  let readyDownloadUrl = null;
  let readyDownloadFilename = 'video.mp4';

  const KNOWN_PLATFORMS = [
    { pattern: /youtube\.com|youtu\.be/, name: "YouTube", badge: "YT", color: "#ef4444" },
    { pattern: /vimeo\.com/, name: "Vimeo", badge: "VIM", color: "#06b6d4" },
    { pattern: /dailymotion\.com/, name: "Dailymotion", badge: "DM", color: "#3b82f6" },
    { pattern: /twitch\.tv/, name: "Twitch", badge: "TW", color: "#9333ea" },
    { pattern: /tiktok\.com/, name: "TikTok", badge: "TT", color: "#ec4899" },
    { pattern: /twitter\.com|x\.com/, name: "Twitter / X", badge: "X", color: "#64748b" },
    { pattern: /instagram\.com/, name: "Instagram", badge: "IG", color: "#e1306c" },
    { pattern: /facebook\.com|fb\.watch/, name: "Facebook", badge: "FB", color: "#2563eb" },
    { pattern: /streamable\.com/, name: "Streamable", badge: "STR", color: "#0ea5e9" },
    { pattern: /wistia\.com|wistia\.net/, name: "Wistia", badge: "WIS", color: "#14b8a6" },
    { pattern: /loom\.com/, name: "Loom", badge: "LM", color: "#f97316" },
    { pattern: /kaltura\.com/, name: "Kaltura", badge: "KAL", color: "#8b5cf6" },
    { pattern: /brightcove\.net/, name: "Brightcove", badge: "BC", color: "#f43f5e" },
    { pattern: /jwplatform\.com|jwplayer\.com/, name: "JW Player", badge: "JW", color: "#d946ef" },
    { pattern: /rumble\.com/, name: "Rumble", badge: "RUM", color: "#84cc16" },
    { pattern: /bitchute\.com/, name: "BitChute", badge: "BC", color: "#f97316" },
    { pattern: /odysee\.com|lbry\.tv/, name: "Odysee", badge: "ODY", color: "#e11d48" },
  ];

  const DIRECT_VIDEO_EXTS = ["mp4", "webm", "ogg", "mov", "avi", "mkv", "m4v", "flv", "3gp"];
  const STREAM_EXTS = ["m3u8", "mpd"];

  // --- Source Detection ---
  function detectSource(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // iframe embed code
    const iframeSrcMatch = trimmed.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeSrcMatch) {
      return { kind: "iframe", url: trimmed, src: iframeSrcMatch[1] };
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const pathname = parsed.pathname.toLowerCase();
    const ext = pathname.split(".").pop() || "";

    if (DIRECT_VIDEO_EXTS.includes(ext) || STREAM_EXTS.includes(ext)) {
      return { kind: "direct", url: trimmed, ext: ext || "mp4" };
    }

    for (const p of KNOWN_PLATFORMS) {
      if (p.pattern.test(parsed.hostname)) {
        return { kind: "known", url: trimmed, platform: p.name, badge: p.badge, color: p.color };
      }
    }

    return { kind: "generic", url: trimmed };
  }

  function getSourceMeta(src) {
    switch (src.kind) {
      case "direct":
        return {
          title: `Video File — ${src.ext.toUpperCase()} Source`,
          platform: "Direct Video File",
          badge: `.${src.ext}`,
          badgeColor: "#06b6d4",
          subtitle: `Source: Direct · Highest Quality .${src.ext.toUpperCase()}`,
        };
      case "iframe": {
        let host = "Embed Player";
        try { host = new URL(src.src).hostname; } catch (_) {}
        return {
          title: `Embedded Player — ${host}`,
          platform: "Embed / iframe",
          badge: "EMBED",
          badgeColor: "#7c3aed",
          subtitle: "Source: Extracted from iframe embed code",
        };
      }
      case "known":
        return {
          title: `${src.platform} Video`,
          platform: src.platform,
          badge: src.badge,
          badgeColor: src.color,
          subtitle: `Source: ${src.platform} · Highest Quality 1080p Original`,
        };
      case "generic": {
        let host = "Online Video";
        try { host = new URL(src.url).hostname; } catch (_) {}
        return {
          title: `Video from ${host}`,
          platform: "Generic Web Stream",
          badge: "URL",
          badgeColor: "#10b981",
          subtitle: "Source: Web · Highest Quality Available",
        };
      }
    }
  }

  // --- Toast ---
  function showToast(message) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = message;
    toast.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
      toast.classList.remove('opacity-100', 'translate-y-0');
    }, 2800);
  }

  // --- Input Mode Switching ---
  function setInputMode(mode) {
    currentMode = mode;
    if (mode === 'url') {
      urlContainer.classList.remove('hidden');
      embedContainer.classList.add('hidden');
      modeUrlBtn.classList.add('bg-[#12121a]', 'text-white', 'shadow-sm');
      modeUrlBtn.classList.remove('text-[#6b6b88]');
      modeEmbedBtn.classList.remove('bg-[#12121a]', 'text-white', 'shadow-sm');
      modeEmbedBtn.classList.add('text-[#6b6b88]');
      urlInput.focus();
    } else {
      urlContainer.classList.add('hidden');
      embedContainer.classList.remove('hidden');
      modeEmbedBtn.classList.add('bg-[#12121a]', 'text-white', 'shadow-sm');
      modeEmbedBtn.classList.remove('text-[#6b6b88]');
      modeUrlBtn.classList.remove('bg-[#12121a]', 'text-white', 'shadow-sm');
      modeUrlBtn.classList.add('text-[#6b6b88]');
      embedInput.focus();
    }
    clearError();
  }

  modeUrlBtn.addEventListener('click', () => setInputMode('url'));
  modeEmbedBtn.addEventListener('click', () => setInputMode('embed'));

  function clearError() {
    errorBox.classList.add('hidden');
    inputError.textContent = '';
  }

  function showError(msg) {
    inputError.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  // --- Form Submit / Analyze ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAnalyze();
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function handleAnalyze() {
    const raw = currentMode === 'url' ? urlInput.value.trim() : embedInput.value.trim();
    if (!raw) {
      showError(currentMode === 'url' ? 'Please paste a video URL first.' : 'Please paste an embed code snippet first.');
      return;
    }

    const detected = detectSource(raw);
    if (!detected) {
      showError('Could not detect a valid video URL or embed code. Please check your input.');
      return;
    }

    clearError();
    detectedSource = detected;
    setState('analyzing');

    // Simulate source extraction or quick probe
    await sleep(900);

    const meta = getSourceMeta(detected);
    if (sourceBadge) {
      sourceBadge.textContent = meta.badge;
      sourceBadge.style.backgroundColor = meta.badgeColor;
    }
    if (sourceIconBox) {
      sourceIconBox.style.backgroundColor = meta.badgeColor + '25';
      const svg = sourceIconBox.querySelector('svg');
      if (svg) svg.style.color = meta.badgeColor;
    }
    if (sourceTitle) sourceTitle.textContent = meta.title;
    if (sourceUrl) sourceUrl.textContent = detected.kind === 'iframe' ? detected.src : detected.url;
    if (sourcePlatformDetails) sourcePlatformDetails.textContent = meta.subtitle;

    // Show preview if direct video URL
    if (detected.kind === 'direct' && DIRECT_VIDEO_EXTS.includes(detected.ext)) {
      videoPreview.src = detected.url;
      videoPreviewWrap.classList.remove('hidden');
      readyDownloadUrl = detected.url;
      readyDownloadFilename = detected.url.split('/').pop() || 'video.mp4';
      if (sourceFileSize) sourceFileSize.textContent = `~Source (${detected.ext.toUpperCase()})`;
    } else {
      videoPreviewWrap.classList.add('hidden');
      readyDownloadUrl = null;
      readyDownloadFilename = 'video.mp4';
      if (sourceFileSize) sourceFileSize.textContent = 'Highest Available (1080p)';
    }

    setState('ready');
  }

  function setState(state) {
    currentState = state;

    if (state === 'idle') {
      idleTags.classList.remove('hidden');
      analyzingBox.classList.add('hidden');
      readyBox.classList.add('hidden');
      progressWrap.classList.add('hidden');
      doneBox.classList.add('hidden');
      results.classList.add('hidden');
      fetchBtn.disabled = false;
      fetchBtnText.textContent = 'Analyze';
      fetchBtnIcon.classList.remove('hidden');
      resetActionBtn.classList.add('hidden');
      downloadActionBtn.classList.remove('hidden');
      downloadActionText.textContent = 'Download (Highest Quality)';
    } else if (state === 'analyzing') {
      idleTags.classList.add('hidden');
      analyzingBox.classList.remove('hidden');
      readyBox.classList.add('hidden');
      clearError();
      fetchBtn.disabled = true;
      fetchBtnText.innerHTML = '<span class="loading loading-spinner loading-xs mr-1"></span> Analyzing…';
    } else if (state === 'ready') {
      idleTags.classList.add('hidden');
      analyzingBox.classList.add('hidden');
      readyBox.classList.remove('hidden');
      progressWrap.classList.add('hidden');
      doneBox.classList.add('hidden');
      fetchBtn.disabled = false;
      fetchBtnText.textContent = 'Analyze';
      resetActionBtn.classList.add('hidden');
      downloadActionBtn.classList.remove('hidden');
      downloadActionText.textContent = 'Download (Highest Quality)';
    } else if (state === 'downloading') {
      progressWrap.classList.remove('hidden');
      doneBox.classList.add('hidden');
      downloadActionBtn.disabled = true;
      downloadActionText.textContent = 'Downloading…';
    } else if (state === 'done') {
      progressWrap.classList.add('hidden');
      doneBox.classList.remove('hidden');
      downloadActionBtn.disabled = false;
      downloadActionText.textContent = 'Save File';
      resetActionBtn.classList.remove('hidden');
    }
  }

  // --- Download Execution ---
  downloadActionBtn.addEventListener('click', () => {
    if (currentState === 'done' && readyDownloadUrl) {
      triggerBrowserDownload(readyDownloadUrl, readyDownloadFilename);
      showToast('Saving file to your device');
      return;
    }
    if (currentState === 'ready') {
      startDownload();
    }
  });

  resetActionBtn.addEventListener('click', () => {
    setState('idle');
    urlInput.value = '';
    embedInput.value = '';
    detectedSource = null;
    clearError();
  });

  async function startDownload() {
    if (!detectedSource) return;
    setState('downloading');
    setProgress(0);

    const targetUrl = detectedSource.kind === 'iframe' ? detectedSource.src : detectedSource.url;

    // Check if target URL is an Instagram/social link that our backend crawler supports
    const isInstagram = /instagram\.com/.test(targetUrl);

    if (isInstagram) {
      // Connect to local backend server jobs API
      try {
        const res = await fetch('/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: targetUrl }),
        });
        const job = await res.json();
        if (!res.ok) throw new Error(job.error || 'Failed to start download job');

        // Poll job
        let p = 15;
        setProgress(p);

        for (;;) {
          await sleep(1400);
          try {
            const statusRes = await fetch('/jobs/' + job.id);
            const statusData = await statusRes.json();

            if (statusData.progress && statusData.progress.message) {
              p = Math.min(85, p + 15);
              setProgress(p);
            }

            if (statusData.status === 'succeeded') {
              setProgress(100);
              await sleep(300);
              await handleCrawlSucceeded(statusData);
              if (readyDownloadUrl) {
                triggerBrowserDownload(readyDownloadUrl, readyDownloadFilename);
                showToast('Download complete! File saved.');
              }
              setState('done');
              break;
            }
            if (statusData.status === 'failed') {
              throw new Error(statusData.error || 'Download failed on server');
            }
          } catch (err) {
            if (err.message && !err.message.includes('fetch')) {
              throw err;
            }
          }
        }
      } catch (err) {
        showError(err.message || 'Error downloading media from link');
        setState('ready');
      }
      return;
    }

    // For direct video files or generic streams, simulate progress and provide direct save
    let p = 0;
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      p += Math.random() * 12 + 6;
      if (p >= 100) {
        clearInterval(progressInterval);
        setProgress(100);
        setTimeout(() => {
          readyDownloadUrl = targetUrl;
          readyDownloadFilename = targetUrl.split('/').pop()?.split('?')[0] || 'download.mp4';
          triggerBrowserDownload(readyDownloadUrl, readyDownloadFilename);
          setState('done');
          showToast('Download complete! File saved.');
        }, 300);
      } else {
        setProgress(Math.round(p));
      }
    }, 160);
  }

  function setProgress(val) {
    const clamped = Math.min(100, Math.max(0, val));
    progressBar.style.width = `${clamped}%`;
    progressPercent.textContent = `${clamped}%`;
  }

  function triggerBrowserDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // --- Crawl Succeeded: Display Saved Media ---
  async function handleCrawlSucceeded(job) {
    const posts = await fetch('/jobs/' + job.id + '/posts').then((r) => r.json()).catch(() => []);
    const items = [];

    for (const post of posts) {
      for (const m of post.media) {
        if (m.status !== 'saved' || !m.localPath) continue;
        items.push({ post, m });
      }
    }

    if (!items.length) {
      showToast('Job complete, but no media files were saved.');
      return;
    }

    // First item sets the preview and primary download
    const first = items[0];
    const firstUrl = '/media/' + first.m.localPath.split('/').map(encodeURIComponent).join('/');
    readyDownloadUrl = firstUrl;
    readyDownloadFilename = first.m.localPath.split('/').pop() || 'media.mp4';

    if (first.m.type === 'video') {
      videoPreview.src = firstUrl;
      videoPreviewWrap.classList.remove('hidden');
    }

    // If multiple media items exist, render the media cards grid
    grid.innerHTML = '';
    for (const { post, m } of items) {
      grid.appendChild(buildMediaCard(post, m));
    }

    cards = $$('.media-card', grid);
    cards.forEach(bindMediaCard);

    resultSubtitle.textContent = `${items.length} saved media item(s) · Highest Quality`;
    results.classList.remove('hidden');
    renderFilter(activeFilter);
    updateSelection();

    showToast('Highest quality media extracted and ready!');
  }

  function buildMediaCard(post, m) {
    const isVideo = m.type === 'video';
    const url = '/media/' + m.localPath.split('/').map(encodeURIComponent).join('/');
    const filename = m.localPath.split('/').pop() || (isVideo ? 'video.mp4' : 'image.jpg');

    const card = document.createElement('article');
    card.className =
      'media-card card bg-[#1a1a28] border border-[rgba(108,99,255,0.15)] rounded-xl overflow-hidden shadow-lg hover:border-[#6c63ff]/40 transition-all cursor-pointer flex flex-col justify-between';
    card.dataset.type = isVideo ? 'video' : 'image';
    card.dataset.url = url;
    card.dataset.filename = filename;

    const mediaVisual = isVideo
      ? `<div class="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          <video src="${url}#t=0.01" preload="metadata" playsinline controls class="w-full h-full object-cover"></video>
          <span class="badge bg-[#6c63ff] text-white border-none font-bold text-[9px] uppercase tracking-wider absolute top-2 left-2 pointer-events-none shadow">MP4 · 1080p</span>
          <div class="selection-check absolute top-2 right-2 w-5 h-5 rounded-md bg-black/60 border border-white/40 flex items-center justify-center transition-colors">
            <svg class="w-3 h-3 text-white opacity-0 transition-opacity"><use href="#i-check"/></svg>
          </div>
        </div>`
      : `<div class="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          <img src="${url}" alt="Saved high resolution image" loading="lazy" class="w-full h-full object-cover" />
          <span class="badge bg-[#1e1e2e] text-[#a0a0b8] border-none font-bold text-[9px] uppercase tracking-wider absolute top-2 left-2 pointer-events-none shadow">Original · High-Res</span>
          <div class="selection-check absolute top-2 right-2 w-5 h-5 rounded-md bg-black/60 border border-white/40 flex items-center justify-center transition-colors">
            <svg class="w-3 h-3 text-white opacity-0 transition-opacity"><use href="#i-check"/></svg>
          </div>
        </div>`;

    card.innerHTML = `
      ${mediaVisual}
      <div class="p-3 flex flex-col gap-2">
        <div class="flex items-center justify-between text-xs text-gray-300 font-mono">
          <span class="truncate font-semibold text-white/90">${post.shortcode || 'Media'}</span>
          <span class="text-[10px] text-[#6b6b88] uppercase">${isVideo ? '1080p MP4' : 'JPG'}</span>
        </div>
        <a href="${url}" download="${filename}" class="single-download btn btn-xs rounded-lg bg-gradient-to-br from-[#6c63ff] to-[#7c3aed] text-white border-none font-semibold text-xs flex items-center justify-center gap-1.5 w-full shadow transition-all">
          <svg class="w-3 h-3"><use href="#i-download"/></svg>
          <span>Save ${isVideo ? 'Video (1080p)' : 'Image'}</span>
        </a>
      </div>
    `;

    return card;
  }

  function bindMediaCard(card) {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.single-download') || event.target.tagName === 'VIDEO') return;
      card.classList.toggle('selected');
      const isSelected = card.classList.contains('selected');
      const checkEl = card.querySelector('.selection-check');
      const checkIcon = card.querySelector('.selection-check svg');
      if (checkEl) {
        checkEl.classList.toggle('bg-[#6c63ff]', isSelected);
        checkEl.classList.toggle('border-[#6c63ff]', isSelected);
      }
      if (checkIcon) {
        checkIcon.classList.toggle('opacity-100', isSelected);
        checkIcon.classList.toggle('opacity-0', !isSelected);
      }
      card.classList.toggle('ring-2', isSelected);
      card.classList.toggle('ring-[#6c63ff]', isSelected);
      updateSelection();
    });
  }

  function renderFilter(filter) {
    activeFilter = filter;
    cards = $$('.media-card', grid);
    let visibleCount = 0;

    cards.forEach((card) => {
      const type = card.dataset.type;
      const match = filter === 'all' || type === filter;
      card.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });

    $$('.filter-btn').forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('bg-[#6c63ff]', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('bg-[#1a1a28]', !active);
      button.classList.toggle('text-[#6b6b88]', !active);
    });

    if (resultsEmpty) {
      resultsEmpty.classList.toggle('hidden', visibleCount > 0 || cards.length === 0);
    }
  }

  $$('.filter-btn').forEach((b) => b.addEventListener('click', () => renderFilter(b.dataset.filter)));

  function selectedCards() {
    return cards.filter((c) => c.classList.contains('selected'));
  }

  function updateSelection() {
    const selected = selectedCards();
    if (selectedCountEl) selectedCountEl.textContent = selected.length;
    if (downloadSelectedBtn) downloadSelectedBtn.disabled = selected.length === 0;
  }

  if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener('click', () => {
      const selected = selectedCards();
      if (!selected.length) return;
      for (const card of selected) {
        triggerBrowserDownload(card.dataset.url, card.dataset.filename);
      }
      showToast(`Saving ${selected.length} file(s)`);
    });
  }
})();
