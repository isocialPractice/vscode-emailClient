/**
 * Webview client for the email panel.
 *
 * All list/header content is rendered through DOM APIs (textContent), never
 * string-concatenated HTML, so message data cannot inject markup. The one
 * exception is the reader body, which receives HTML already sanitized by
 * the extension host and is additionally constrained by the panel CSP.
 */

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const state = {
    backend: 'mock',
    mailboxes: [],
    activeMailboxId: '',
    messages: [],
    openMessage: null,
    sanitizedHtml: '',
    filter: '',
    composeBusy: false,
  };

  const app = document.getElementById('app');
  let els = null;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        state.backend = msg.backend;
        state.mailboxes = msg.mailboxes;
        state.activeMailboxId = msg.activeMailboxId;
        state.messages = [];
        state.openMessage = null;
        buildShell();
        renderAll();
        break;
      case 'mailboxes':
        state.mailboxes = msg.mailboxes;
        renderSidebar();
        break;
      case 'messageList':
        if (msg.mailboxId === state.activeMailboxId) {
          state.messages = msg.messages;
          if (state.openMessage && !state.messages.some((m) => m.id === state.openMessage.id)) {
            state.openMessage = null;
          }
          renderList();
          renderReader();
        }
        break;
      case 'message':
        state.openMessage = msg.message;
        state.sanitizedHtml = msg.sanitizedHtml || '';
        const row = state.messages.find((m) => m.id === msg.message.id);
        if (row) {
          row.keywords = msg.message.keywords;
        }
        renderList();
        renderReader();
        break;
      case 'sendResult':
        state.composeBusy = false;
        setComposeBusy(false);
        if (msg.outcome.success) {
          closeCompose();
          toast('info', 'Message sent.');
        } else {
          toast('error', msg.outcome.error || 'Send failed.');
        }
        break;
      case 'draftSaved':
        closeCompose();
        toast('info', 'Draft saved.');
        break;
      case 'notice':
        toast(msg.level, msg.text);
        break;
      case 'compose':
        openCompose(msg.draft || {});
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });

  // ── Shell ────────────────────────────────────────────────────────────

  function buildShell() {
    if (els) {
      return;
    }
    app.dataset.state = 'ready';
    app.textContent = '';

    const toolbar = el('div', 'toolbar');
    const composeBtn = el('button', 'btn-primary', 'Compose');
    composeBtn.addEventListener('click', () => openCompose({}));
    const refreshBtn = el('button', 'btn-secondary', 'Refresh');
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'search';
    search.placeholder = 'Search subject, sender, preview';
    search.setAttribute('aria-label', 'Search messages');
    search.addEventListener('input', () => {
      state.filter = search.value.trim().toLowerCase();
      renderList();
    });
    const spacer = el('div', 'spacer');
    const badge = el('span', 'backend-badge');
    badge.id = 'backend-badge';
    toolbar.append(composeBtn, refreshBtn, search, spacer, badge);

    const layout = el('div', 'layout');
    const sidebar = el('nav', 'pane pane-sidebar');
    sidebar.setAttribute('aria-label', 'Mailboxes');
    const list = el('section', 'pane pane-list');
    list.setAttribute('aria-label', 'Messages');
    const reader = el('section', 'pane pane-reader reader');
    reader.setAttribute('aria-label', 'Message content');
    layout.append(sidebar, list, reader);

    const toastRegion = el('div', 'toast-region');
    toastRegion.setAttribute('role', 'status');
    toastRegion.setAttribute('aria-live', 'polite');

    app.append(toolbar, layout, toastRegion);
    els = { sidebar, list, reader, badge, toastRegion };
  }

  function renderAll() {
    renderSidebar();
    renderList();
    renderReader();
    els.badge.textContent = state.backend === 'mock' ? 'Mock server' : 'Live';
  }

  // ── Sidebar ──────────────────────────────────────────────────────────

  function renderSidebar() {
    if (!els) {
      return;
    }
    els.sidebar.textContent = '';
    const ul = el('ul', 'mailbox-list');
    for (const mailbox of state.mailboxes) {
      const li = el('li', 'mailbox-item' + (mailbox.id === state.activeMailboxId ? ' active' : ''));
      const btn = document.createElement('button');
      btn.setAttribute(
        'aria-label',
        mailbox.name + (mailbox.unreadCount ? ', ' + mailbox.unreadCount + ' unread' : '')
      );
      const name = el('span', 'mailbox-name', mailbox.name);
      btn.append(name);
      if (mailbox.unreadCount > 0) {
        btn.append(el('span', 'unread-pill', String(mailbox.unreadCount)));
      }
      btn.addEventListener('click', () => {
        state.activeMailboxId = mailbox.id;
        state.openMessage = null;
        renderSidebar();
        vscode.postMessage({ type: 'selectMailbox', mailboxId: mailbox.id });
      });
      li.append(btn);
      ul.append(li);
    }
    els.sidebar.append(ul);
  }

  // ── Message list ─────────────────────────────────────────────────────

  function visibleMessages() {
    if (!state.filter) {
      return state.messages;
    }
    return state.messages.filter((m) => {
      const from = (m.from || []).map((a) => (a.name || '') + ' ' + a.email).join(' ');
      return (
        (m.subject || '').toLowerCase().includes(state.filter) ||
        from.toLowerCase().includes(state.filter) ||
        (m.preview || '').toLowerCase().includes(state.filter)
      );
    });
  }

  function renderList() {
    if (!els) {
      return;
    }
    els.list.textContent = '';
    const messages = visibleMessages();
    if (messages.length === 0) {
      els.list.append(
        el('div', 'empty-state', state.filter ? 'No messages match the search.' : 'No messages.')
      );
      return;
    }
    const ul = el('ul', 'message-list');
    ul.addEventListener('keydown', onListKeydown);
    for (const message of messages) {
      const unread = !message.keywords.$seen;
      const selected = state.openMessage && state.openMessage.id === message.id;
      const li = el(
        'li',
        'message-row' + (unread ? ' unread' : '') + (selected ? ' selected' : '')
      );
      const btn = document.createElement('button');
      btn.dataset.messageId = message.id;

      const top = el('div', 'row-top');
      top.append(el('span', 'row-from', formatAddresses(message.from)));
      top.append(el('span', 'row-date', formatDate(message.receivedAt)));

      const subjectLine = el('div', 'row-subject');
      if (message.keywords.$flagged) {
        const flag = el('span', 'flag-dot', '⚑');
        flag.setAttribute('aria-label', 'Flagged');
        subjectLine.append(flag);
      }
      subjectLine.append(document.createTextNode(message.subject || '(no subject)'));
      if (message.hasAttachment) {
        const clip = el('span', 'clip', '📎');
        clip.setAttribute('aria-label', 'Has attachment');
        subjectLine.append(clip);
      }

      btn.append(top, subjectLine);
      if (message.preview) {
        btn.append(el('div', 'row-preview', message.preview));
      }
      btn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openMessage',
          mailboxId: state.activeMailboxId,
          messageId: message.id,
        });
      });
      li.append(btn);
      ul.append(li);
    }
    els.list.append(ul);
  }

  function onListKeydown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) {
      return;
    }
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    if (next >= 0 && next < buttons.length) {
      buttons[next].focus();
    }
  }

  // ── Reader ───────────────────────────────────────────────────────────

  function renderReader() {
    if (!els) {
      return;
    }
    els.reader.textContent = '';
    const message = state.openMessage;
    if (!message) {
      els.reader.append(el('div', 'empty-state', 'Select a message to read it.'));
      return;
    }

    const header = el('div', 'reader-header');
    header.append(el('h1', 'reader-subject', message.subject || '(no subject)'));

    const meta = el('div', 'reader-meta');
    meta.append(metaLine('From', formatAddresses(message.from)));
    meta.append(metaLine('To', formatAddresses(message.to)));
    if (message.cc && message.cc.length) {
      meta.append(metaLine('Cc', formatAddresses(message.cc)));
    }
    meta.append(metaLine('Date', new Date(message.receivedAt).toLocaleString()));
    header.append(meta);

    const actions = el('div', 'reader-actions');
    actions.append(
      actionButton('Reply', 'btn-secondary', () => openReply(message)),
      actionButton(
        message.keywords.$flagged ? 'Unflag' : 'Flag',
        'btn-secondary',
        () => postKeyword(message, '$flagged', !message.keywords.$flagged)
      ),
      actionButton('Mark unread', 'btn-secondary', () => {
        postKeyword(message, '$seen', false);
        state.openMessage = null;
        renderReader();
      }),
      actionButton('Delete', 'btn-danger', () => {
        vscode.postMessage({
          type: 'deleteMessage',
          mailboxId: state.activeMailboxId,
          messageId: message.id,
        });
        state.openMessage = null;
        renderReader();
      })
    );
    header.append(actions);

    if (message.attachments && message.attachments.length) {
      const chips = el('div', 'attachment-chips');
      for (const attachment of message.attachments) {
        chips.append(
          el(
            'span',
            'attachment-chip',
            attachment.name + ' (' + formatSize(attachment.size) + ')'
          )
        );
      }
      header.append(chips);
    }

    const body = el('div', 'reader-body');
    // Host-sanitized HTML; scripts are additionally blocked by the CSP.
    body.innerHTML = state.sanitizedHtml;

    els.reader.append(header, body);
  }

  function metaLine(label, value) {
    const line = el('div', 'meta-line');
    const strong = document.createElement('strong');
    strong.textContent = label + ': ';
    line.append(strong, document.createTextNode(value));
    return line;
  }

  function actionButton(text, className, onClick) {
    const btn = el('button', className, text);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function postKeyword(message, keyword, value) {
    vscode.postMessage({
      type: 'setKeyword',
      mailboxId: state.activeMailboxId,
      messageId: message.id,
      keyword: keyword,
      value: value,
    });
  }

  // ── Compose ──────────────────────────────────────────────────────────

  let composeEls = null;

  function openCompose(prefill) {
    closeCompose();
    const overlay = el('div', 'compose-overlay');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        closeCompose();
      }
    });

    const dialog = el('div', 'compose');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Compose email');

    dialog.append(el('div', 'compose-header', prefill.inReplyToId ? 'Reply' : 'New message'));

    const body = el('div', 'compose-body');
    const to = composeField(body, 'To', 'jane.doe@example.com', prefill.to || '');
    const cc = composeField(body, 'Cc', '', prefill.cc || '');
    const subject = composeField(body, 'Subject', '', prefill.subject || '');

    const bodyField = el('div', 'compose-field');
    const bodyLabel = document.createElement('label');
    bodyLabel.textContent = 'Message';
    bodyLabel.htmlFor = 'compose-message';
    const textarea = document.createElement('textarea');
    textarea.id = 'compose-message';
    // For replies the user's cursor starts in the empty compose area;
    // the quoted original is kept in quotedHtml and appended at send time.
    textarea.value = prefill.body || '';
    bodyField.append(bodyLabel, textarea);
    body.append(bodyField);

    const footer = el('div', 'compose-footer');
    const sendBtn = el('button', 'btn-primary', 'Send');
    sendBtn.addEventListener('click', submit);
    const draftBtn = el('button', 'btn-secondary', 'Save draft');
    draftBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'saveDraft', draft: collect() });
    });
    const spacer = el('div', 'spacer');
    const discardBtn = el('button', 'btn-danger', 'Discard');
    discardBtn.addEventListener('click', closeCompose);
    footer.append(sendBtn, draftBtn, spacer, discardBtn);

    dialog.append(body, footer);
    overlay.append(dialog);
    document.body.append(overlay);
    composeEls = { overlay, to, cc, subject, textarea, sendBtn, draftId: prefill.id, inReplyToId: prefill.inReplyToId, quotedHtml: prefill.quotedHtml || '' };
    to.focus();

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeCompose();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        submit();
      }
    });

    function collect() {
      // The textarea accepts raw HTML. Pass the content through as-is and wrap
      // in a div; the send bridge writes it to a temp file and uses --message-html
      // so formatting (h1, p, b, i, etc.) is preserved by the SMTP client.
      const body = '<div>' + textarea.value + '</div>' + (composeEls.quotedHtml || '');
      return {
        id: composeEls.draftId,
        to: to.value,
        cc: cc.value,
        subject: subject.value,
        body: body,
        isHtml: true,
        inReplyToId: composeEls.inReplyToId,
      };
    }

    function submit() {
      if (state.composeBusy) {
        return;
      }
      state.composeBusy = true;
      setComposeBusy(true);
      vscode.postMessage({ type: 'sendDraft', draft: collect() });
    }
  }

  function composeField(parent, label, placeholder, value) {
    const field = el('div', 'compose-field');
    const id = 'compose-' + label.toLowerCase();
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = id;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.placeholder = placeholder;
    input.value = value;
    field.append(labelEl, input);
    parent.append(field);
    return input;
  }

  function setComposeBusy(busy) {
    if (composeEls) {
      composeEls.sendBtn.disabled = busy;
      composeEls.sendBtn.textContent = busy ? 'Sending…' : 'Send';
    }
  }

  function closeCompose() {
    state.composeBusy = false;
    if (composeEls) {
      composeEls.overlay.remove();
      composeEls = null;
    }
  }

  function openReply(message) {
    const sender = message.replyTo && message.replyTo.length ? message.replyTo : message.from;
    const subject = /^re:/i.test(message.subject || '')
      ? message.subject
      : 'Re: ' + (message.subject || '');
    // Prefer HTML body; strip any HTML tags from plaintext to avoid leaking
    // raw markup into the quoted section.
    const rawSource = message.bodyValues && message.bodyValues.text
      ? message.bodyValues.text
      : message.preview || '';
    // Strip tags so the quoted line renders as clean plain text inside the blockquote.
    const plainSource = rawSource.replace(/<[^>]*>/g, '');
    const quotedHtml =
      '<div style="margin-top:1em">' +
      '<p>On ' + new Date(message.receivedAt).toLocaleString() + ', ' +
      formatAddresses(message.from) + ' wrote:</p>' +
      '<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #888">' +
      plainSource +
      '</blockquote>' +
      '</div>';
    openCompose({
      to: formatAddresses(sender),
      subject: subject,
      body: '',
      quotedHtml: quotedHtml,
      inReplyToId: message.id,
    });
  }

  // ── Toasts ───────────────────────────────────────────────────────────

  function toast(level, text) {
    if (!els) {
      return;
    }
    const item = el('div', 'toast ' + (level === 'info' ? '' : level), text);
    els.toastRegion.append(item);
    setTimeout(() => item.remove(), 6000);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function formatAddresses(addresses) {
    if (!addresses || addresses.length === 0) {
      return '(unknown)';
    }
    return addresses.map((a) => a.name || a.email).join(', ');
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString();
  }

  function formatSize(bytes) {
    if (typeof bytes !== 'number' || bytes < 0) {
      return '';
    }
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
})();
