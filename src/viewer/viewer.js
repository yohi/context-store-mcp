let currentOffset = 0;
const limit = 20;
let totalMemories = 0;

// 認証トークンの取得（環境変数またはローカルストレージから）
const authToken = localStorage.getItem('authToken') || '';

async function loadMemories() {
  showLoading();
  hideError();

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
    return loadMemories();
  }

  const searchType = document.querySelector('input[name="searchType"]:checked').value;

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
    displayMemories(data.results, query);
  } catch (error) {
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function displayMemories(memories, highlightQuery = null) {
  const list = document.getElementById('memoriesList');
  list.innerHTML = '';

  if (memories.length === 0) {
    list.innerHTML = '<p>記憶が見つかりませんでした。</p>';
    return;
  }

  memories.forEach(memory => {
    const item = document.createElement('div');
    item.className = 'memory-item';

    let content = memory.content;
    if (highlightQuery) {
      // ハイライト処理
      const regex = new RegExp(`(${escapeRegex(highlightQuery)})`, 'gi');
      content = content.replace(regex, '<mark>$1</mark>');
    }

    const tags = memory.metadata?.tags || [];
    const tagsHtml = tags.map(tag => `<span class="tag">${tag}</span>`).join('');

    const similarityHtml = memory.similarity !== undefined
      ? `<span class="similarity-score">スコア: ${(memory.similarity * 100).toFixed(1)}%</span>`
      : '';

    item.innerHTML = `
      <div class="memory-header">
        <div class="memory-meta">
          <strong>ID:</strong> ${memory.id.substring(0, 8)}...
          <strong>作成:</strong> ${new Date(memory.createdAt).toLocaleString('ja-JP')}
        </div>
        ${similarityHtml}
      </div>
      <div class="memory-content">${content}</div>
      <div class="memory-tags">${tagsHtml}</div>
    `;

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
    loadMemories();
  }
}

function nextPage() {
  if (currentOffset + limit < totalMemories) {
    currentOffset += limit;
    loadMemories();
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
