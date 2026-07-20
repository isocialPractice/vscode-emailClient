/**
 * Manage Accounts webview client.
 *
 * Initial state is the account list. Each account offers Edit and Delete;
 * the Add Account button opens the same form empty. All content is built
 * with DOM APIs (textContent), never string-concatenated HTML, so account
 * data cannot inject markup.
 */

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SECRET_PLACEHOLDER = '__unchanged__';

  const state = { accounts: [], roots: [], warnings: [] };
  const app = document.getElementById('app');
  let toastRegion = null;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'accounts') {
      state.accounts = msg.accounts || [];
      state.roots = msg.roots || [];
      state.warnings = msg.warnings || [];
      renderList();
    } else if (msg.type === 'notice') {
      toast(msg.level, msg.text);
    } else if (msg.type === 'closeDialog') {
      closeDialog();
    } else if (msg.type === 'openAdd') {
      openDialog(null);
    }
  });

  vscode.postMessage({ type: 'ready' });

  // ── List ─────────────────────────────────────────────────────────────

  function renderList() {
    app.textContent = '';

    const page = el('div', 'page');
    const header = el('div', 'page-header');
    header.append(el('h1', null, 'Email Accounts'));
    const addBtn = el('button', 'btn-primary', 'Add Account');
    addBtn.addEventListener('click', () => openDialog(null));
    const refreshBtn = el('button', 'btn-secondary', 'Refresh');
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    header.append(addBtn, refreshBtn);
    page.append(header);

    page.append(
      el(
        'p',
        'subtitle',
        state.accounts.length === 1
          ? '1 account configured.'
          : state.accounts.length + ' accounts configured.'
      )
    );

    if (state.accounts.length === 0) {
      page.append(emptyState());
    } else {
      const list = el('ul', 'account-list');
      for (const account of state.accounts) {
        list.append(accountCard(account));
      }
      page.append(list);
    }

    if (state.warnings.length > 0) {
      page.append(warningsPanel());
    }

    toastRegion = el('div', 'toast-region');
    toastRegion.setAttribute('role', 'status');
    toastRegion.setAttribute('aria-live', 'polite');

    app.append(page, toastRegion);
  }

  function accountCard(account) {
    const li = el('li', 'account-card');

    const main = el('div', 'account-main');
    const title = el('div', 'account-title');
    title.append(el('span', 'account-name', account.name));
    title.append(el('span', 'badge', account.capability));
    if (account.active) {
      title.append(el('span', 'badge badge-active', 'active'));
    }
    if (!account.editable) {
      const native = el('span', 'badge badge-native', 'tool module');
      native.title = 'Defined by a companion tool module; edit the file directly.';
      title.append(native);
    }
    main.append(title);

    if (account.email) {
      main.append(el('div', 'account-email', account.email));
    }
    for (const file of account.files) {
      main.append(el('div', 'account-files', file));
    }

    const actions = el('div', 'account-actions');
    const editBtn = el('button', 'btn-secondary', 'Edit');
    editBtn.setAttribute('aria-label', 'Edit ' + account.name);
    editBtn.addEventListener('click', () => {
      if (account.editable) {
        openDialog(account);
      } else {
        vscode.postMessage({ type: 'openFile', name: account.name });
      }
    });
    const deleteBtn = el('button', 'btn-danger', 'Delete');
    deleteBtn.setAttribute('aria-label', 'Delete ' + account.name);
    deleteBtn.addEventListener('click', () =>
      vscode.postMessage({ type: 'delete', name: account.name })
    );
    actions.append(editBtn, deleteBtn);

    li.append(main, actions);
    return li;
  }

  function emptyState() {
    const panel = el('div', 'empty-panel');
    panel.append(el('p', null, 'No accounts found yet.'));
    panel.append(
      el('p', null, 'Use Add Account, or drop a configuration file in one of these locations:')
    );

    const roots = el('div', 'roots');
    if (state.roots.length === 0) {
      roots.append(el('p', null, 'No registry root is available. Open a folder in VS Code, or set emailClient.accountsRoot.'));
    } else {
      roots.append(el('div', null, 'Searched under:'));
      const ul = document.createElement('ul');
      for (const root of state.roots) {
        for (const sub of ['accounts', 'extract-email/accounts', 'send-email/config/accounts']) {
          const li = document.createElement('li');
          const code = document.createElement('code');
          code.textContent = root + '/' + sub + '/';
          li.append(code);
          ul.append(li);
        }
      }
      roots.append(ul);
    }
    panel.append(roots);
    return panel;
  }

  function warningsPanel() {
    const panel = el('div', 'warnings');
    panel.append(el('strong', null, 'Configuration warnings'));
    const ul = document.createElement('ul');
    for (const warning of state.warnings) {
      const li = document.createElement('li');
      li.textContent = warning;
      ul.append(li);
    }
    panel.append(ul);
    return panel;
  }

  // ── Editor dialog ────────────────────────────────────────────────────

  let dialogEls = null;

  function openDialog(account) {
    closeDialog();
    const isNew = !account;
    const input = account ? account.input : { name: '', capability: 'both', imap: {}, smtp: {} };

    const overlay = el('div', 'overlay');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        closeDialog();
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDialog();
      }
    });

    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', isNew ? 'Add account' : 'Edit account ' + account.name);
    dialog.append(el('div', 'dialog-header', isNew ? 'Add account' : 'Edit ' + account.name));

    const body = el('div', 'dialog-body');

    const nameField = textField('Account name', input.name || '', 'work');
    nameField.input.setAttribute('aria-describedby', 'name-hint');
    body.append(nameField.wrapper);
    const nameHint = el('div', 'hint', 'Used as the file name and the master property inside it.');
    nameHint.id = 'name-hint';
    body.append(nameHint);

    const capWrapper = el('div', 'field');
    const capLabel = document.createElement('label');
    capLabel.textContent = 'Capability';
    capLabel.htmlFor = 'capability';
    const capSelect = document.createElement('select');
    capSelect.id = 'capability';
    for (const option of [
      { value: 'both', text: 'Extract and send' },
      { value: 'extract-only', text: 'Extract only' },
      { value: 'send-only', text: 'Send only' },
    ]) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.text;
      capSelect.append(opt);
    }
    capSelect.value = input.capability || 'both';
    capWrapper.append(capLabel, capSelect);
    body.append(capWrapper);

    // Extraction fieldset
    const imap = input.imap || {};
    const extractSet = document.createElement('fieldset');
    const extractLegend = document.createElement('legend');
    extractLegend.textContent = 'Extraction (IMAP)';
    extractSet.append(extractLegend);
    const imapHost = textField('Host', imap.host || '', 'imap.example.com');
    const imapPort = numberField('Port', imap.port != null ? imap.port : 993);
    const imapRow = el('div', 'field-row');
    imapRow.append(imapHost.wrapper, imapPort.wrapper);
    const imapUser = textField('User', imap.user || '', 'jane.doe@example.com');
    const imapPass = passwordField('Password', imap.password || '');
    const imapTls = checkboxField('Use TLS', imap.tls !== false);
    const foldersField = textField(
      'Folders (besides Inbox, comma-separated)',
      (input.folders || []).join(', '),
      'Sent, Drafts, Trash'
    );
    extractSet.append(
      imapRow,
      imapUser.wrapper,
      imapPass.wrapper,
      imapTls.wrapper,
      foldersField.wrapper
    );
    body.append(extractSet);

    // Sending fieldset
    const smtp = input.smtp || {};
    const sendSet = document.createElement('fieldset');
    const sendLegend = document.createElement('legend');
    sendLegend.textContent = 'Sending (SMTP)';
    sendSet.append(sendLegend);
    const smtpHost = textField('Host', smtp.host || '', 'smtp.example.com');
    const smtpPort = numberField('Port', smtp.port != null ? smtp.port : 587);
    const smtpRow = el('div', 'field-row');
    smtpRow.append(smtpHost.wrapper, smtpPort.wrapper);
    const smtpUser = textField('User', smtp.user || '', 'jane.doe@example.com');
    const smtpPass = passwordField('Password', smtp.pass || '');
    const smtpSecure = checkboxField('Secure (implicit TLS, port 465)', smtp.secure === true);
    sendSet.append(smtpRow, smtpUser.wrapper, smtpPass.wrapper, smtpSecure.wrapper);
    body.append(sendSet);

    function applyCapability() {
      const value = capSelect.value;
      extractSet.hidden = value === 'send-only';
      sendSet.hidden = value === 'extract-only';
    }
    capSelect.addEventListener('change', applyCapability);
    applyCapability();

    const footer = el('div', 'dialog-footer');
    const saveBtn = el('button', 'btn-primary', 'Save');
    saveBtn.addEventListener('click', submit);
    const spacer = el('div', 'spacer');
    const cancelBtn = el('button', 'btn-secondary', 'Cancel');
    cancelBtn.addEventListener('click', closeDialog);
    footer.append(saveBtn, spacer, cancelBtn);

    dialog.append(body, footer);
    overlay.append(dialog);
    document.body.append(overlay);
    dialogEls = { overlay };
    nameField.input.focus();

    function submit() {
      const capability = capSelect.value;
      const folders = foldersField.input.value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const payload = {
        name: nameField.input.value.trim(),
        capability: capability,
        folders: capability === 'send-only' || folders.length === 0 ? undefined : folders,
        imap:
          capability === 'send-only'
            ? undefined
            : {
                host: imapHost.input.value.trim(),
                port: toNumber(imapPort.input.value),
                user: imapUser.input.value.trim(),
                password: imapPass.input.value,
                tls: imapTls.input.checked,
              },
        smtp:
          capability === 'extract-only'
            ? undefined
            : {
                host: smtpHost.input.value.trim(),
                port: toNumber(smtpPort.input.value),
                user: smtpUser.input.value.trim(),
                pass: smtpPass.input.value,
                secure: smtpSecure.input.checked,
              },
      };
      vscode.postMessage({
        type: 'save',
        input: payload,
        originalName: account ? account.name : undefined,
      });
    }
  }

  function closeDialog() {
    if (dialogEls) {
      dialogEls.overlay.remove();
      dialogEls = null;
    }
  }

  // ── Field builders ───────────────────────────────────────────────────

  let fieldId = 0;

  function baseField(labelText, inputEl) {
    const wrapper = el('div', 'field');
    const id = 'field-' + fieldId++;
    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = id;
    inputEl.id = id;
    wrapper.append(label, inputEl);
    return { wrapper: wrapper, input: inputEl };
  }

  function textField(labelText, value, placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    if (placeholder) {
      input.placeholder = placeholder;
    }
    return baseField(labelText, input);
  }

  function passwordField(labelText, value) {
    const input = document.createElement('input');
    input.type = 'password';
    input.value = value;
    if (value === SECRET_PLACEHOLDER) {
      input.setAttribute('aria-describedby', 'secret-hint');
      input.title = 'Stored password kept unless you replace it.';
    }
    return baseField(labelText, input);
  }

  function numberField(labelText, value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.min = '1';
    input.max = '65535';
    return baseField(labelText, input);
  }

  function checkboxField(labelText, checked) {
    const wrapper = el('div', 'field-inline');
    const id = 'field-' + fieldId++;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = id;
    wrapper.append(input, label);
    return { wrapper: wrapper, input: input };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  function toNumber(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function toast(level, text) {
    if (!toastRegion) {
      return;
    }
    const item = el('div', 'toast ' + (level === 'info' ? '' : level), text);
    toastRegion.append(item);
    setTimeout(() => item.remove(), 6000);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }
})();
