let currentOffset = 0;
const limit = 20;
let totalMemories = 0;
let lastSearchQuery = null; // 検索コンテキストを保持

// 認証トークンの取得（環境変数またはローカルストレージから）
const authToken = localStorage.getItem('authToken') || '';

async function loadMemories() {
  showLoading();
  hideError();
  lastSearchQuery = null; // 検索コンテキストをクリア

  try {
    const response = await fetch(`/memories?limit=${limit}&offset=${currentOffset}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load memories');
    }

    const data = await response.json();
    totalMemories = data.total;
    displayMemories(data.memories);
    updatePagination();
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

async function search() {
  const query = document.getElementById('searchQuery').value;
  if (!query.trim()) {
    lastSearchQuery = null; // 検索コンテキストをクリア
    currentOffset = 0; // オフセットもリセット
    return loadMemories();
  }

  // 新しい検索クエリの場合はオフセットをリセット
  if (lastSearchQuery !== query) {
    currentOffset = 0;
  }

  let searchTypeElement = document.querySelector('input[name="searchType"]:checked');
  if (!searchTypeElement) {
    const defaultRadio = document.querySelector('input[name="searchType"][value="text"]');
    if (defaultRadio) {
      defaultRadio.checked = true;
      searchTypeElement = defaultRadio;
    }
  }
  const searchType = searchTypeElement ? searchTypeElement.value : 'text';

  showLoading();
  hideError();

  try {
    const response = await fetch('/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        query,
        searchType,
        limit,
        offset: currentOffset
      })
    });

    if (!response.ok) {
      throw new Error('Failed to search memories');
    }

    const data = await response.json();
    totalMemories = data.total || data.results.length;
    lastSearchQuery = query; // 検索コンテキストを保存
    displayMemories(data.results, query);
    updatePagination();
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

// HTMLエスケープ関数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ハイライト処理を安全に行う関数
function highlightText(text, query) {
  if (!query) return escapeHtml(text);

  const escapedText = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');

  // エスケープ済みテキストに対してmarkタグを挿入
  return escapedText.replace(regex, '<mark>$1</mark>');
}

function displayMemories(memories, highlightQuery = null) {
  const list = document.getElementById('memoriesList');
  list.innerHTML = '';

  if (memories.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = '記憶が見つかりませんでした。';
    list.appendChild(emptyMessage);
    return;
  }

  memories.forEach(memory => {
    const item = document.createElement('div');
    item.className = 'memory-item';

    // ヘッダー部分の構築
    const header = document.createElement('div');
    header.className = 'memory-header';

    const meta = document.createElement('div');
    meta.className = 'memory-meta';

    const idLabel = document.createElement('strong');
    idLabel.textContent = 'ID:';
    meta.appendChild(idLabel);
    meta.appendChild(document.createTextNode(' '));

    const idValue = document.createTextNode(memory.id ? (memory.id.length >= 8 ? memory.id.substring(0, 8) + '...' : memory.id) : '[IDなし]');
    meta.appendChild(idValue);
    meta.appendChild(document.createTextNode(' '));

    const dateLabel = document.createElement('strong');
    dateLabel.textContent = '作成:';
    meta.appendChild(dateLabel);
    meta.appendChild(document.createTextNode(' '));

    const dateValue = document.createTextNode(new Date(memory.createdAt).toLocaleString('ja-JP'));
    meta.appendChild(dateValue);

    header.appendChild(meta);

    // 類似度スコアの追加（存在する場合）
    if (memory.similarity !== undefined) {
      const similaritySpan = document.createElement('span');
      similaritySpan.className = 'similarity-score';
      similaritySpan.textContent = `スコア: ${(memory.similarity * 100).toFixed(1)}%`;
      header.appendChild(similaritySpan);
    }

    item.appendChild(header);

    // コンテンツ部分の構築（ハイライト処理を含む）
    const contentDiv = document.createElement('div');
    contentDiv.className = 'memory-content';

    if (highlightQuery) {
      // ハイライト処理: エスケープ済みHTMLを使用
      contentDiv.innerHTML = highlightText(memory.content, highlightQuery);
    } else {
      // ハイライトなし: textContentで安全に挿入
      contentDiv.textContent = memory.content;
    }

    item.appendChild(contentDiv);

    // タグ部分の構築
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'memory-tags';

    const tags = memory.metadata?.tags || [];
    tags.forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'tag';
      tagSpan.textContent = tag; // textContentで安全に挿入
      tagsDiv.appendChild(tagSpan);
    });

    item.appendChild(tagsDiv);
    list.appendChild(item);
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showLoading() {
  document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

function hideError() {
  document.getElementById('error').style.display = 'none';
}

function updatePagination() {
  const currentPage = Math.floor(currentOffset / limit) + 1;
  const totalPages = Math.ceil(totalMemories / limit);
  document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
}

function previousPage() {
  if (currentOffset >= limit) {
    currentOffset -= limit;
    // 検索コンテキストがあれば検索を、なければ通常のロードを実行
    if (lastSearchQuery) {
      search();
    } else {
      loadMemories();
    }
  }
}

function nextPage() {
  if (currentOffset + limit < totalMemories) {
    currentOffset += limit;
    // 検索コンテキストがあれば検索を、なければ通常のロードを実行
    if (lastSearchQuery) {
      search();
    } else {
      loadMemories();
    }
  }
}

// 初期ロード
loadMemories();

// Enterキーで検索
document.getElementById('searchQuery').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    search();
  }
});
