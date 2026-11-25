/* 知谱 · 应用逻辑
   数据: window.TUTOR_SUBJECTS / window.TUTOR_DATA.<key>
   引擎: window.DiagEngine (buildGraph/createSession/nextItem/applyAnswer/summarize/judgeQuestion/...) */
(function () {
  'use strict';
  var E = window.DiagEngine;
  var SUBS = window.TUTOR_SUBJECTS || {};
  var KEYS = Object.keys(SUBS);
  // 错因四类（错题归因器）：由孩子自己归类，AI 不代判、不推题海
  var CAUSES = {
    knowledge: { label: '知识性', tip: '概念不清、公式记混，记题号 + 知识点' },
    method: { label: '方法性', tip: '会但走错路，记题号 + 更好的方法' },
    slip: { label: '失误性', tip: '审题漏条件、算错抄错——不抄题，写规避动作' },
    undone: { label: '未完成', tip: '时间不够没做完，记卡在哪一步' }
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var STORE = {
    get: function (k, d) { try { var v = localStorage.getItem('zhipu_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('zhipu_' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('zhipu_' + k); } catch (e) {} }
  };

  var S = {
    subject: STORE.get('subject', KEYS[0] || 'math'),
    graph: null, data: null,
    view: 'home',
    exGrade: '', exChapter: '', exTopic: null, exQuery: '',
    diag: { mode: 'grade', grade: '', progress: '上', targetGrade: '', targets: [], query: '',
      limit: 16, confirm: 3, diagMode: 'target' },
    session: null, item: null, choice: null,
    wrong: STORE.get('wrong', []),
    wrongFilter: { subject: '', grade: '', cause: '' },
    wrongReveal: {},          // 哪些错题已揭开答案（仅本次会话）
    wrongShowArchived: false
  };

  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }

  /* ---------- 数据加载 ---------- */
  function loadSubject(key) {
    if (S.subject === key && S.graph) return;
    S.subject = key; S.graph = null; S.data = null;
    if (window.TUTOR_DATA && window.TUTOR_DATA[key]) return finish(key);
    var s = document.createElement('script');
    s.src = 'data/' + key + '.js';
    s.onload = function () { finish(key); };
    s.onerror = function () { toast('加载 ' + key + ' 数据失败'); };
    document.head.appendChild(s);
  }
  function finish(key) {
    S.data = window.TUTOR_DATA[key];
    S.graph = E.buildGraph(S.data.topics, S.data.dependencies, S.data.questions);
    STORE.set('subject', key);
    loadDiagState();
    enrichWrongGrades();
    renderSubjectSwitch(); renderHome(); renderExplore(); renderDiagSetup(); renderWrong();
  }
  function needData(cb) { if (S.graph) cb(); else loadSubject(S.subject, cb); }

  /* ---------- 导航 ---------- */
  function nav(view) {
    S.view = view;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('#view-' + view); if (el) el.classList.add('active');
    $$('#nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === view); });
    window.scrollTo(0, 0);
    if (view === 'explore') renderExplore();
    if (view === 'diagnose') renderDiagSetup();
    if (view === 'report') renderReport();
    if (view === 'wrong') renderWrong();
  }

  /* ---------- 学科切换 ---------- */
  function renderSubjectSwitch() {
    var el = $('#subjectSwitch'); el.innerHTML = '';
    KEYS.forEach(function (k) {
      var m = SUBS[k], b = document.createElement('button');
      b.textContent = m.icon + ' ' + m.name;
      b.className = k === S.subject ? 'active' : '';
      b.style.background = k === S.subject ? m.color : '';
      b.onclick = function () { loadSubject(k); };
      el.appendChild(b);
    });
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    var tt = 0, td = 0, tq = 0;
    KEYS.forEach(function (k) { tt += SUBS[k].topicCount; td += SUBS[k].depCount; tq += SUBS[k].questionCount; });
    $('#statTopics').textContent = tt.toLocaleString();
    $('#statDeps').textContent = td.toLocaleString();
    $('#statQuestions').textContent = tq.toLocaleString();
    $('#statSubjects').textContent = KEYS.length;
    var grid = $('#subjectGrid'); grid.innerHTML = '';
    KEYS.forEach(function (k) {
      var m = SUBS[k], d = document.createElement('div');
      d.className = 'subject-card'; d.style.cursor = 'pointer';
      d.innerHTML = '<div class="sc-bar" style="background:' + m.color + '"></div>' +
        '<div class="sc-go">→</div><div class="sc-icon">' + m.icon + '</div>' +
        '<h3>' + m.name + '</h3><div class="sc-desc">小学 1–6 年级 · ' + m.domains.length + ' 个知识领域</div>' +
        '<div class="sc-nums"><div><b>' + m.topicCount + '</b>知识点</div>' +
        '<div><b>' + m.questionCount + '</b>诊断题</div><div><b>' + m.depCount + '</b>先修关系</div></div>';
      d.onclick = function () { loadSubject(k); S.diag.mode = 'grade'; nav('diagnose'); };
      grid.appendChild(d);
    });
  }

  /* ---------- 图谱 ---------- */
  function gradeLabel(t) {
    var g = t.grade, sem = t.semester;
    var cn = ['一', '二', '三', '四', '五', '六'][(g || 1) - 1] || g;
    return cn + '年级' + (sem === '上' ? '上册' : sem === '下' ? '下册' : '');
  }
  function chapterKey(t) { return (t.chapter || '未分章').split(/\s+/).slice(0, 3).join(' '); }

  function renderExplore() {
    needData(function () {
      var sel = $('#exGrade');
      if (!sel.dataset.ready) {
        var gs = SUBS[S.subject].grades;
        gs.forEach(function (g) {
          var o = document.createElement('option'); o.value = g;
          o.textContent = gradeLabel({ grade: g, semester: '上' }).replace('上册', '');
          sel.appendChild(o);
        });
        sel.dataset.ready = '1';
        sel.onchange = function () { S.exGrade = this.value; S.exChapter = ''; S.exTopic = null; renderExplore(); };
        $('#exSearch').oninput = function () { S.exQuery = this.value.trim(); S.exTopic = null; renderExplore(); };
      }
      // 重设学科后年级选项可能变化：简化处理，清空重建
      sel.innerHTML = '<option value="">全部年级</option>';
      SUBS[S.subject].grades.forEach(function (g) {
        var o = document.createElement('option'); o.value = g;
        o.textContent = gradeLabel({ grade: g, semester: '上' }).replace('上册', '');
        if (String(g) === String(S.exGrade)) o.selected = true;
        sel.appendChild(o);
      });

      var topics = S.data.topics.filter(function (t) {
        if (S.exGrade && String(t.grade) !== String(S.exGrade)) return false;
        if (S.exQuery && t.name.indexOf(S.exQuery) < 0 && (t.description || '').indexOf(S.exQuery) < 0) return false;
        return true;
      });
      // 章节分组
      var groups = {};
      topics.forEach(function (t) {
        var k = chapterKey(t); (groups[k] = groups[k] || []).push(t);
      });
      var gk = Object.keys(groups);
      if (S.exChapter && !groups[S.exChapter]) S.exChapter = '';
      var cl = $('#chapterList'); cl.innerHTML = '';
      var all = document.createElement('div'); all.className = 'chapter-group';
      var allBtn = document.createElement('button');
      allBtn.innerHTML = '<span>全部知识点</span><span class="cg-n">' + topics.length + '</span>';
      allBtn.className = S.exChapter ? '' : 'active';
      allBtn.onclick = function () { S.exChapter = ''; renderExplore(); };
      all.appendChild(allBtn); cl.appendChild(all);
      gk.forEach(function (k) {
        var div = document.createElement('div'); div.className = 'chapter-group';
        var b = document.createElement('button');
        b.innerHTML = '<span title="' + esc(k) + '">' + esc(k.length > 16 ? k.slice(0, 15) + '…' : k) + '</span>' +
          '<span class="cg-n">' + groups[k].length + '</span>';
        b.className = S.exChapter === k ? 'active' : '';
        b.title = k;
        b.onclick = function () { S.exChapter = k; S.exTopic = null; renderExplore(); };
        div.appendChild(b); cl.appendChild(div);
      });
      $('#exCount').textContent = gk.length + ' 章';

      var shown = S.exChapter ? groups[S.exChapter] || [] : topics;
      var tl = $('#topicList'); tl.innerHTML = '';
      if (!shown.length) { tl.innerHTML = '<div class="empty-state"><div class="es-icon">🔍</div>没有匹配的知识点</div>'; }
      shown.forEach(function (t) {
        var d = document.createElement('div');
        d.className = 'topic-item' + (S.exTopic && S.exTopic.id === t.id ? ' active' : '');
        var color = SUBS[S.subject].color;
        d.innerHTML = '<span class="ti-dot" style="background:' + color + '"></span>' +
          '<span class="ti-name">' + esc(t.name) + '</span><span class="ti-grade">' + gradeLabel(t) + '</span>';
        d.onclick = function () { S.exTopic = t; renderTopicDetail(); $$('.topic-item', tl).forEach(function (x) { x.classList.remove('active'); }); d.classList.add('active'); };
        tl.appendChild(d);
      });
      renderTopicDetail();
    });
  }

  function renderTopicDetail() {
    var box = $('#topicDetail');
    if (!S.exTopic) { box.innerHTML = '<div class="empty">← 点击左侧知识点查看详情</div>'; return; }
    var t = S.exTopic, g = S.graph;
    var pre = (g.prereqs[t.id] || []).map(function (p) {
      var pt = g.byId[p.id];
      return '<div class="rel-node" data-goto="' + p.id + '"><span class="rn-tag ' +
        (p.strength === 'hard' ? 'rn-hard">必会' : 'rn-soft">有帮助') + '</span>' + esc(pt ? pt.name : p.id) + '</div>' +
        (p.reason ? '<div class="rel-reason">' + esc(p.reason) + '</div>' : '');
    }).join('') || '<div class="muted" style="font-size:12px">起点知识点，没有前置依赖</div>';
    var dep = (g.dependents[t.id] || []).slice(0, 12).map(function (d) {
      var dt = g.byId[d.id];
      return '<div class="rel-node" data-goto="' + d.id + '"><span class="rn-tag rn-self">后续</span>' + esc(dt ? dt.name : d.id) + '</div>';
    }).join('') || '<div class="muted" style="font-size:12px">暂无后续知识点</div>';
    var crit = (t.mastery_criteria || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    var qn = (g.bank[t.id] || []).length;
    box.innerHTML =
      '<span class="td-domain">' + esc(t.domain || '综合') + '</span>' +
      '<h3>' + esc(t.name) + '</h3>' +
      '<div class="td-chapter">' + esc(t.chapter || '') + ' · ' + gradeLabel(t) + '</div>' +
      '<div class="td-desc">' + esc(t.description || '') + '</div>' +
      (crit ? '<div class="td-label">掌握标准</div><ul class="td-criteria">' + crit + '</ul>' : '') +
      '<div class="td-label">先修（学它之前要会）</div><div class="rel-chain">' + pre + '</div>' +
      '<div class="td-label">后续（学会后能接）</div><div class="rel-chain">' + dep + '</div>' +
      '<div class="td-actions"><button class="btn primary" id="btnDiagThis">诊断这个点</button>' +
      '<span class="muted" style="font-size:12px;align-self:center">题库 ' + qn + ' 题</span></div>';
    $$('[data-goto]', box).forEach(function (n) {
      n.onclick = function () {
        var nt = g.byId[n.dataset.goto]; if (nt) { S.exTopic = nt; renderTopicDetail(); }
      };
    });
    $('#btnDiagThis').onclick = function () {
      S.diag.mode = 'topic'; S.diag.targets = [t.id]; S.diag.targetGrade = t.grade ? String(t.grade) : '';
      loadDiagState(); nav('diagnose'); renderDiagSetup();
    };
  }

  /* ---------- 诊断设置 ---------- */
  function loadDiagState() {
    var d = STORE.get('diag_' + S.subject, null);
    if (!d) return;
    if (S.diag.mode === 'grade' && !S.diag.targets.length) S.diag = Object.assign(S.diag, d);
    else if (S.diag.mode === 'topic' && !S.diag.targets.length && d.targetGrade) S.diag.targetGrade = d.targetGrade;
  }
  function saveDiagState() { STORE.set('diag_' + S.subject, S.diag); }

  function renderDiagSetup() {
    needData(function () {
      // 学科 chips
      var ds = $('#diagSubjects'); ds.innerHTML = '';
      KEYS.forEach(function (k) {
        var b = document.createElement('button'); b.className = 'chip' + (k === S.subject ? ' active' : '');
        b.textContent = SUBS[k].icon + ' ' + SUBS[k].name;
        b.onclick = function () { loadSubject(k); S.diag.targets = []; S.diag.grade = ''; S.diag.targetGrade = ''; };
        ds.appendChild(b);
      });
      // 年级 chips
      var gc = $('#gradeChips'); gc.innerHTML = '';
      SUBS[S.subject].grades.forEach(function (g) {
        var ranges = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
        var b = document.createElement('button'); b.className = 'chip';
        b.textContent = (ranges[g] || g) + '年级'; b.dataset.g = g;
        if (String(S.diag.grade) === String(g)) b.classList.add('active');
        b.onclick = function () {
          S.diag.grade = g; S.diag.targets = []; saveDiagState(); renderDiagSetup();
        };
        gc.appendChild(b);
      });
      renderTargetGradeChips();
      $$('#scopeMode button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.mode === S.diag.mode);
        b.onclick = function () {
          var to = b.dataset.mode;
          // 从「按年级」切过来时自动带上已选年级，实现联动
          if (to === 'topic' && !S.diag.targetGrade && S.diag.grade) S.diag.targetGrade = String(S.diag.grade);
          S.diag.mode = to; saveDiagState(); renderDiagSetup();
        };
      });
      $$('#progressMode button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.progress === S.diag.progress);
        b.onclick = function () { S.diag.progress = b.dataset.progress; renderDiagSetup(); };
      });
      $('#scopeGrade').classList.toggle('hidden', S.diag.mode !== 'grade');
      $('#scopeTopic').classList.toggle('hidden', S.diag.mode !== 'topic');
      $('#optLimit').value = S.diag.limit; $('#optConfirm').value = S.diag.confirm; $('#optMode').value = S.diag.diagMode;
      updateSelectedTargets(); renderTargetResults();
    });
  }
  function updateSelectedTargets() {
    var names = S.diag.targets.map(function (id) { var t = S.graph && S.graph.byId[id]; return t ? t.name : id; });
    $('#selectedTargets').textContent = names.length ? names.join('、') : '无';
  }
  function renderTargetGradeChips() {
    var box = $('#targetGradeChips'); if (!box) return;
    box.innerHTML = '';
    var cn = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };
    var opts = [{ v: '', label: '全部年级' }].concat(SUBS[S.subject].grades.map(function (g) {
      return { v: String(g), label: (cn[g] || g) + '年级' };
    }));
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'chip' + (String(S.diag.targetGrade) === o.v ? ' active' : '');
      b.textContent = o.label;
      b.onclick = function () {
        S.diag.targetGrade = o.v; saveDiagState();
        renderTargetGradeChips(); renderTargetResults();
      };
      box.appendChild(b);
    });
  }
  function renderTargetResults() {
    var box = $('#targetResults'), q = S.diag.query.trim();
    var tg = S.diag.targetGrade ? Number(S.diag.targetGrade) : 0;
    if (!q && !tg) { box.innerHTML = '<div class="tr-empty">选一个年级浏览，或输入关键词搜索</div>'; return; }
    var pool = S.data.topics.filter(function (t) {
      if (tg && Number(t.grade) !== tg) return false;
      if (q && t.name.indexOf(q) < 0 && String(t.chapter || '').indexOf(q) < 0) return false;
      return true;
    });
    if (!pool.length) { box.innerHTML = '<div class="tr-empty">没有匹配的知识点，换个年级或关键词试试</div>'; return; }
    var hits = pool.slice(0, 60);
    box.innerHTML = '';
    var info = document.createElement('div');
    info.className = 'tr-count';
    info.textContent = '共 ' + pool.length + ' 个知识点' + (pool.length > hits.length ? '，先显示前 ' + hits.length + ' 个' : '') + '，点击可多选';
    box.appendChild(info);
    hits.forEach(function (t) {
      var d = document.createElement('div');
      var on = S.diag.targets.indexOf(t.id) >= 0;
      d.className = 'tr-item' + (on ? ' active' : '');
      var chap = String(t.chapter || '').replace(/^[一二三四五六]年级[上下]册?\s*/, '');
      var meta = gradeLabel(t) + (tg && chap ? ' · ' + chap : '');
      d.innerHTML = '<span>' + esc(t.name) + '</span><span class="muted">' + esc(meta) + (on ? ' ✓' : '') + '</span>';
      d.onclick = function () {
        var i = S.diag.targets.indexOf(t.id);
        if (i >= 0) S.diag.targets.splice(i, 1); else S.diag.targets.push(t.id);
        saveDiagState(); renderTargetResults(); updateSelectedTargets();
      };
      box.appendChild(d);
    });
  }

  function startDiagnosis() {
    var g = S.graph, d = S.diag, ids = [];
    if (d.mode === 'grade') {
      if (!d.grade) { $('#setupError').textContent = '请先选择年级'; return; }
      var cnGrade = ['一', '二', '三', '四', '五', '六'][Number(d.grade) - 1] || d.grade;
      var res = E.gradeTargets(g, cnGrade + '年级', 'all');
      // 只取当前学科
      var pref = { math: 'cnm_', chinese: 'cnc_', english: 'cne_', science: 'cns_' }[S.subject];
      ids = (res ? res.ids : []).filter(function (id) { return id.indexOf(pref) === 0; });
      if (d.progress === '上') {
        var f = E.filterByProgress(g, ids, '上', Number(d.grade)); ids = f.ids;
      }
    } else {
      ids = d.targets.slice();
    }
    ids = ids.filter(function (id) { return E.isTestable(g, id); });
    if (!ids.length) { $('#setupError').textContent = '该范围内没有可诊断的知识点，请换个选择'; return; }
    $('#setupError').textContent = '';
    d.limit = Number($('#optLimit').value); d.confirm = Number($('#optConfirm').value); d.diagMode = $('#optMode').value;
    saveDiagState();
    S.session = E.createSession(g, ids, { limit: d.limit, confirm: d.confirm, mode: d.diagMode, seed: 'zhipu-' + Date.now() });
    STORE.set('session_' + S.subject, { subject: S.subject, targets: ids, answers: [], opts: { limit: d.limit, confirm: d.confirm, mode: d.diagMode, seed: S.session.seed }, started: Date.now() });
    $('#setupPanel').classList.add('hidden'); $('#quizPanel').classList.remove('hidden');
    nextQuiz();
  }

  /* ---------- 答题 ---------- */
  function nextQuiz() {
    var g = S.graph, s = S.session;
    S.item = E.nextItem(g, s); S.choice = null;
    $('#quizFeedback').classList.add('hidden');
    $('#btnNext').classList.add('hidden'); $('#btnSubmit').classList.remove('hidden');
    if (!S.item) { finishQuiz(); return; }
    var q = S.item.question, t = g.byId[S.item.topicId];
    var sum = E.summarize(g, s);
    $('#quizBar').style.width = (sum.asked / sum.limit * 100) + '%';
    $('#quizCount').textContent = '第 ' + (sum.asked + 1) + ' / ' + sum.limit + ' 题';
    $('#quizTopic').textContent = t ? t.name : S.item.topicId;
    $('#quizQuestion').textContent = q.prompt;
    var ch = $('#quizChoices'), iw = $('#quizInputWrap'), sw = $('#quizSelfWrap');
    ch.innerHTML = ''; iw.classList.add('hidden'); sw.classList.add('hidden');
    $('#quizInput').value = '';
    if (q.type === 'choice' && Array.isArray(q.choices)) {
      q.choices.forEach(function (c) {
        var b = document.createElement('button'); b.className = 'quiz-choice'; b.dataset.key = c.key;
        b.innerHTML = '<span class="qc-key">' + esc(c.key) + '</span><span>' + esc(c.text) + '</span>';
        b.onclick = function () {
          S.choice = c.key;
          $$('.quiz-choice', ch).forEach(function (x) { x.classList.remove('selected'); }); b.classList.add('selected');
        };
        ch.appendChild(b);
      });
    } else if (q.type === 'self') {
      $$('button', sw).forEach(function (b) {
        b.onclick = function () { S.choice = b.dataset.self === 'correct' ? 'correct' : 'wrong'; submitQuiz(); };
      });
      sw.classList.remove('hidden');
    } else {
      iw.classList.remove('hidden');
      $('#quizInput').onkeydown = function (e) { if (e.key === 'Enter') submitQuiz(); };
    }
  }

  function submitQuiz() {
    if (!S.item) return;
    var q = S.item.question, qid = q.id, user = '', result;
    if (q.type === 'choice') {
      if (!S.choice) { toast('请选择一个答案'); return; }
      user = S.choice;
      result = E.judgeQuestion(q, user).verdict;
    } else if (q.type === 'self') {
      user = S.choice;
      result = S.choice === 'correct' ? 'correct' : 'wrong';
    } else {
      user = $('#quizInput').value.trim();
      if (!user) { toast('请输入答案'); return; }
      result = E.judgeQuestion(q, user).verdict;
      if (result === 'manual') {
        // 自评题无法自动判定，按「不会」处理
        result = 'wrong';
      }
    }
    if (result !== 'correct' && result !== 'wrong') result = 'wrong';
    // 记录错题
    if (result !== 'correct') {
      var wt = S.graph.byId[S.item.topicId] || {};
      S.wrong.unshift({ subject: S.subject, subjectName: (SUBS[S.subject] || {}).name || S.subject,
        grade: wt.grade || '', semester: wt.semester || '',
        topicId: S.item.topicId, topicName: wt.name || S.item.topicId,
        qid: qid, qtype: q.type || '', cause: '', archived: false,
        options: q.type === 'choice' && q.choices ? q.choices : null,
        prompt: q.prompt, answer: q.answer, user: user,
        explanation: q.explanation || '', time: Date.now() });
      S.wrong = S.wrong.slice(0, 300); STORE.set('wrong', S.wrong); renderWrongBadge();
    }
    // 应用作答：pin 钉住当前题
    S.session = E.applyAnswer(S.graph, S.session, S.item.topicId, result, { pin: true, qid: qid, text: user });
    var st = STORE.get('session_' + S.subject, null);
    if (st) { st.answers.push({ id: S.item.topicId, qid: qid, result: result, text: user }); STORE.set('session_' + S.subject, st); }
    // 反馈
    var fb = $('#quizFeedback');
    fb.className = 'quiz-feedback ' + (result === 'correct' ? 'ok' : 'bad');
    fb.innerHTML = '<b>' + (result === 'correct' ? '✓ 答对了' : '✗ 答错了 / 还没掌握') + '</b>' +
      '<div>正确答案：' + esc(q.answer) + (q.explanation ? '<br>解析：' + esc(q.explanation) : '') + '</div>';
    fb.classList.remove('hidden');
    $$('.quiz-choice', $('#quizChoices')).forEach(function (b) {
      if (b.dataset.key === String(q.answer)) b.classList.add('correct');
      else if (b.dataset.key === S.choice) b.classList.add('wrong');
    });
    $('#btnSubmit').classList.add('hidden'); $('#btnNext').classList.remove('hidden');
  }

  function finishQuiz() {
    $('#quizPanel').classList.add('hidden');
    STORE.del('session_' + S.subject);
    nav('report');
  }

  /* ---------- 报告 ---------- */
  function renderReport() {
    needData(function () {
      var box = $('#reportBody');
      if (!S.session) { box.innerHTML = '<div class="empty-state"><div class="es-icon">📊</div>还没有诊断结果，先做一次诊断吧。</div>'; return; }
      var g = S.graph, s = S.session, sum = E.summarize(g, s), m = SUBS[S.subject];
      $('#reportSub').textContent = m.name + ' · ' + (S.diag.mode === 'grade' ? S.diag.grade + '年级' : S.diag.targets.length + ' 个目标点') +
        ' · 共作答 ' + sum.asked + ' 题';
      var stCount = function (arr) { return arr.length; };
      var html = '<div class="summary-grid">' +
        '<div class="sum-card mastered"><b>' + stCount(sum.mastered) + '</b><span>已掌握</span></div>' +
        '<div class="sum-card shaky"><b>' + stCount(sum.shaky) + '</b><span>不稳（会但易错）</span></div>' +
        '<div class="sum-card weak"><b>' + stCount(sum.weak) + '</b><span>薄弱</span></div>' +
        '<div class="sum-card untested"><b>' + stCount(sum.untested) + '</b><span>未测 / 未学</span></div></div>';

      // 可观察表述：会做什么 / 卡在哪一步 / 下一步做什么（不编造达成率）
      function names(ids, n) {
        return ids.slice(0, n || 3).map(function (id) { var t = g.byId[id]; return t ? t.name : id; }).join('、');
      }
      var firstStep = sum.path[0] ? g.byId[sum.path[0].id] : null;
      var obs = '<div class="report-card obs-card"><h3><span class="rc-icon">👀</span>接下来怎么做</h3>';
      obs += '<div class="obs-row"><span class="obs-k">能独立做出</span><span class="obs-v">' +
        (sum.mastered.length ? esc(names(sum.mastered)) + ' 等 ' + sum.mastered.length + ' 个点' : '这次还没有连续答对满条件的点') + '</span></div>';
      obs += '<div class="obs-row"><span class="obs-k">卡在哪一步</span><span class="obs-v">' +
        (sum.roots.length ? esc(names(sum.roots, 2)) + ' 这类前置内容' : '这次的诊断里没定位到明确的卡点') + '</span></div>';
      obs += '<div class="obs-row"><span class="obs-k">下一步练什么</span><span class="obs-v">' +
        (firstStep ? '先练「' + esc(firstStep.name) + '」，合上答案独立做对再往下走' : '当前范围都已测完，可以换个范围或加大题量再测') + '</span></div>';
      obs += '<div class="obs-foot">以上按本次作答如实描述，不是能力评价；正式判断请老师结合课堂表现核对。</div></div>';
      html += obs;

      // 根因
      html += '<div class="report-card"><h3><span class="rc-icon">🎯</span>最可能的卡点（根因）</h3>';
      if (!sum.roots.length) {
        html += '<div class="muted" style="font-size:13px">没有发现明确的根因。' +
          (sum.limitReached ? '题量已用完，部分前置点还没测到，可增加题量再测。' : '看起来基础不错。') + '</div>';
      } else {
        sum.roots.forEach(function (r) {
          var t = g.byId[r.id];
          html += '<div class="root-card"><div class="rt-name">' + esc(t ? t.name : r.id) + '</div>' +
            '<div class="rt-meta">' + esc(t ? t.chapter || '' : '') + ' · ' + (t ? gradeLabel(t) : '') +
            (r.pendingPrereqs && r.pendingPrereqs.length ? ' · 还有 ' + r.pendingPrereqs.length + ' 个更前置的点没测到' : '') + '</div></div>';
        });
      }
      html += '</div>';

      // 补学路径
      if (sum.path.length) {
        html += '<div class="report-card"><h3><span class="rc-icon">🧭</span>补学路径（按先修顺序）</h3><div class="path-list">';
        sum.path.slice(0, 30).forEach(function (p, i) {
          var t = g.byId[p.id];
          var tag = p.status === 'weak' ? '<span class="ps-tag pt-weak">薄弱</span>' :
            p.status === 'shaky' ? '<span class="ps-tag pt-shaky">不稳</span>' :
              '<span class="ps-tag pt-unknown">未测</span>';
          if (p.isRoot) tag += '<span class="ps-tag pt-weak">根因</span>';
          if (p.isTarget) tag += '<span class="ps-tag pt-target">目标</span>';
          html += '<div class="path-step"><div class="path-num">' + (i + 1) + '</div><div class="ps-body">' +
            '<div class="ps-name">' + esc(t ? t.name : p.id) + tag + '</div>' +
            '<div class="ps-meta">' + esc(t ? t.chapter || '' : '') + (t ? ' · ' + gradeLabel(t) : '') + '</div></div></div>';
        });
        html += '</div></div>';
      }

      // 不稳点
      if (sum.shaky.length) {
        html += '<div class="report-card"><h3><span class="rc-icon">⚡</span>不稳的知识点（建议再练）</h3><div class="chart-row">';
        sum.shaky.forEach(function (id) {
          var t = g.byId[id];
          html += '<span class="chart-chip">' + esc(t ? t.name : id) + '</span>';
        });
        html += '</div></div>';
      }
      box.innerHTML = html;
    });
  }

  /* ---------- 错题本 ---------- */
  function wrongSubjectName(w) {
    return w.subjectName || (SUBS[w.subject] || {}).name || w.subject || '其它';
  }
  function wrongGradeText(w) {
    return w.grade ? gradeLabel({ grade: w.grade, semester: w.semester }) : '';
  }
  // 选择题把选项 key 还原成完整文字（如 "A" → "A. 4"）
  function wrongOptionText(w, key) {
    if (!w.options || !w.options.length || key == null) return '';
    var o = w.options.filter(function (x) { return String(x.key) === String(key); })[0];
    return o ? (o.key + '. ' + o.text) : '';
  }
  // 旧记录没有年级：等对应学科数据加载后，用知识点自身的年级册次回填
  function enrichWrongGrades() {
    if (!S.graph) return;
    var changed = false;
    S.wrong.forEach(function (w) {
      if (w.subject !== S.subject) return;
      var t = S.graph.byId[w.topicId];
      if (!t) return;
      if (!w.grade && t.grade) { w.grade = t.grade; changed = true; }
      if (!w.semester && t.semester) { w.semester = t.semester; changed = true; }
      if (!w.subjectName && SUBS[w.subject]) { w.subjectName = SUBS[w.subject].name; changed = true; }
    });
    if (changed) STORE.set('wrong', S.wrong);
  }
  function gradeRank(s) {
    var m = /([一二三四五六])年级(上|下)?/.exec(String(s || ''));
    var cn = ['一', '二', '三', '四', '五', '六'];
    return (m ? cn.indexOf(m[1]) + 1 : 9) * 10 + (m && m[2] === '下' ? 1 : 0);
  }
  function renderWrongFilters() {
    var subs = {}, grades = {};
    S.wrong.forEach(function (w) {
      if (w.subject) subs[w.subject] = 1;
      var gl = wrongGradeText(w);
      if (gl) grades[gl] = 1;
    });
    if (S.wrongFilter.subject && !subs[S.wrongFilter.subject]) S.wrongFilter.subject = '';
    if (S.wrongFilter.grade && !grades[S.wrongFilter.grade]) S.wrongFilter.grade = '';
    function fill(box, opts, cur, key) {
      box.innerHTML = '';
      opts.forEach(function (o) {
        var b = document.createElement('button');
        b.className = 'wf-chip' + (cur === o.value ? ' active' : '');
        b.textContent = o.label;
        b.onclick = function () { S.wrongFilter[key] = o.value; renderWrong(); };
        box.appendChild(b);
      });
    }
    var subjectOpts = [{ value: '', label: '全部' }].concat(
      Object.keys(subs).sort(function (a, b) { return KEYS.indexOf(a) - KEYS.indexOf(b); })
        .map(function (k) { return { value: k, label: (SUBS[k] || {}).name || k }; }));
    var gradeOpts = [{ value: '', label: '全部' }].concat(
      Object.keys(grades).sort(function (a, b) { return gradeRank(a) - gradeRank(b); })
        .map(function (g) { return { value: g, label: g }; }));
    fill($('#wrongSubjectChips'), subjectOpts, S.wrongFilter.subject, 'subject');
    fill($('#wrongGradeChips'), gradeOpts, S.wrongFilter.grade, 'grade');
    $('#wrongFilters').classList.toggle('hidden', !S.wrong.length);
  }
  function wrongKey(w) { return String(w.qid || '') + '|' + String(w.time || ''); }
  function wrongFind(key) {
    return S.wrong.filter(function (w) { return wrongKey(w) === key; })[0];
  }
  function wrongSave() { STORE.set('wrong', S.wrong); }
  function renderWrongBadge() {
    var n = S.wrong.filter(function (w) { return !w.archived; }).length;
    $('#wrongBadge').textContent = n;
  }
  function renderWrongFilters() {
    var subs = {}, grades = {};
    S.wrong.forEach(function (w) {
      if (w.archived) return;
      if (w.subject) subs[w.subject] = 1;
      var gl = wrongGradeText(w);
      if (gl) grades[gl] = 1;
    });
    if (S.wrongFilter.subject && !subs[S.wrongFilter.subject]) S.wrongFilter.subject = '';
    if (S.wrongFilter.grade && !grades[S.wrongFilter.grade]) S.wrongFilter.grade = '';
    if (S.wrongFilter.cause && !CAUSES[S.wrongFilter.cause] && S.wrongFilter.cause !== 'none') S.wrongFilter.cause = '';
    function fill(box, opts, cur, key) {
      box.innerHTML = '';
      opts.forEach(function (o) {
        var b = document.createElement('button');
        b.className = 'wf-chip' + (cur === o.value ? ' active' : '');
        b.textContent = o.label;
        b.onclick = function () { S.wrongFilter[key] = o.value; renderWrong(); };
        box.appendChild(b);
      });
    }
    var subjectOpts = [{ value: '', label: '全部' }].concat(
      Object.keys(subs).sort(function (a, b) { return KEYS.indexOf(a) - KEYS.indexOf(b); })
        .map(function (k) { return { value: k, label: (SUBS[k] || {}).name || k }; }));
    var gradeOpts = [{ value: '', label: '全部' }].concat(
      Object.keys(grades).sort(function (a, b) { return gradeRank(a) - gradeRank(b); })
        .map(function (g) { return { value: g, label: g }; }));
    var causeOpts = [{ value: '', label: '全部错因' }, { value: 'none', label: '未归类' }]
      .concat(Object.keys(CAUSES).map(function (c) { return { value: c, label: CAUSES[c].label }; }));
    fill($('#wrongSubjectChips'), subjectOpts, S.wrongFilter.subject, 'subject');
    fill($('#wrongGradeChips'), gradeOpts, S.wrongFilter.grade, 'grade');
    fill($('#wrongCauseChips'), causeOpts, S.wrongFilter.cause, 'cause');
    $('#wrongFilters').classList.toggle('hidden', !S.wrong.length);
  }
  function renderWrongSummary(active) {
    var box = $('#wrongSummary');
    if (!active.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var counts = { knowledge: 0, method: 0, slip: 0, undone: 0, none: 0 };
    active.forEach(function (w) { counts[CAUSES[w.cause] ? w.cause : 'none']++; });
    var html = '<div class="ws-head">错因分布 <span>只统计未归档；先自己归类，再决定练什么</span></div><div class="ws-row">';
    Object.keys(CAUSES).forEach(function (c) {
      html += '<div class="ws-cell"><b>' + CAUSES[c].label + '</b><span>' + counts[c] + ' 道</span></div>';
    });
    html += '<div class="ws-cell"><b>未归类</b><span>' + counts.none + ' 道</span></div></div>';
    var hot = Object.keys(CAUSES).filter(function (c) { return counts[c] >= 3; })
      .sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if (hot) {
      html += '<div class="ws-note">「' + CAUSES[hot].label + '」出现 ' + counts[hot] + ' 次。可以先只练这一类：' +
        CAUSES[hot].tip + '。挑 3–5 道，合上答案独立做对就算过。</div>';
    } else {
      html += '<div class="ws-note">同一类出现 3 次以上时，再单独拎出来练；现在不用急着刷题。</div>';
    }
    html += '<div class="ws-foot">归类由孩子自己完成；这份记录只用来安排练习，不用于评价。</div>';
    box.innerHTML = html;
    box.classList.remove('hidden');
  }
  function renderWrong() {
    renderWrongBadge();
    renderWrongFilters();
    var box = $('#wrongBody');
    if (!S.wrong.length) {
      $('#wrongSummary').classList.add('hidden');
      box.innerHTML = '<div class="empty-state"><div class="es-icon">📒</div>错题本还是空的。答错的题会自动收进这里。</div>';
      return;
    }
    var active = S.wrong.filter(function (w) { return !w.archived; });
    renderWrongSummary(active);
    var list = active.filter(function (w) {
      if (S.wrongFilter.subject && w.subject !== S.wrongFilter.subject) return false;
      if (S.wrongFilter.grade && wrongGradeText(w) !== S.wrongFilter.grade) return false;
      if (S.wrongFilter.cause === 'none' && CAUSES[w.cause]) return false;
      if (S.wrongFilter.cause && S.wrongFilter.cause !== 'none' && w.cause !== S.wrongFilter.cause) return false;
      return true;
    });
    var archiveList = S.wrongShowArchived ? S.wrong.filter(function (w) { return !!w.archived; }) : [];
    if (!list.length && !archiveList.length) {
      box.innerHTML = '<div class="empty-state"><div class="es-icon">🔍</div>没有符合条件的错题，换个科目、年级或错因看看。</div>';
      return;
    }
    function itemHtml(w, archived) {
      var key = wrongKey(w);
      var sm = SUBS[w.subject] || {};
      var col = /^#[0-9a-fA-F]{6}$/.test(sm.color || '') ? sm.color : 'var(--accent)';
      var gl = wrongGradeText(w);
      var revealed = !!S.wrongReveal[key] || archived;
      var html = '<div class="wrong-item" data-key="' + esc(key) + '">' +
        '<div class="wi-tags"><span class="wtag wtag-sub" style="--tag:' + col + '">' + esc(wrongSubjectName(w)) + '</span>' +
        (gl ? '<span class="wtag wtag-grade">' + esc(gl) + '</span>' : '') +
        (CAUSES[w.cause] ? '<span class="wtag wtag-cause">' + CAUSES[w.cause].label + '</span>' : '') +
        (archived ? '<span class="wtag wtag-done">已归档</span>' : '') + '</div>' +
        '<div class="wi-q">' + esc(w.prompt) + '</div>';
      if (!archived) {
        html += '<div class="wi-cause"><span>我归类为</span>';
        Object.keys(CAUSES).forEach(function (c) {
          html += '<button class="cf-chip' + (w.cause === c ? ' active' : '') +
            '" data-wact="cause" data-cause="' + c + '" title="' + esc(CAUSES[c].tip) + '">' +
            CAUSES[c].label + '</button>';
        });
        html += '</div>';
      }
      if (!revealed) {
        html += '<button class="btn ghost wi-reveal" data-wact="reveal">先自己做一遍，再点这里对答案 ↓</button>';
      } else {
        var ansText = wrongOptionText(w, w.answer) || String(w.answer == null ? '' : w.answer);
        var userText = w.user ? (wrongOptionText(w, w.user) || String(w.user)) : '—';
        if (w.options && w.options.length && w.user && !wrongOptionText(w, w.user)) userText += '（选项已更新）';
        html += '<div class="wi-ans"><div>正确答案 <span class="ok">' + esc(ansText) + '</span></div>' +
          '<div>你的答案 <span class="bad">' + esc(userText) + '</span></div></div>' +
          (w.explanation ? '<div class="wi-exp">解析：' + esc(w.explanation) + '</div>' : '');
        html += '<div class="wi-actions">' +
          (archived
            ? '<button class="btn ghost small" data-wact="unarchive">恢复到待复盘</button>'
            : '<button class="btn ghost small" data-wact="rehide">还没掌握，收起答案</button>' +
              '<button class="btn small" data-wact="archive">这次独立做对了，归档 ✓</button>') +
          '</div>';
      }
      return html + '</div>';
    }
    var html = '';
    if (list.length) {
      var byTopic = {};
      list.forEach(function (w) {
        var k = w.subject + '|' + w.topicId;
        (byTopic[k] = byTopic[k] || { name: w.topicName, subject: w.subject, items: [] }).items.push(w);
      });
      Object.keys(byTopic).forEach(function (k) {
        var grp = byTopic[k], m = SUBS[grp.subject] || {};
        html += '<div class="wrong-group"><h3>' + esc(grp.name) + '</h3>' +
          '<div class="wg-meta">' + (m.icon || '') + ' ' + esc(wrongSubjectName(grp)) + ' · ' + grp.items.length + ' 道错题</div>';
        grp.items.slice(0, 8).forEach(function (w) { html += itemHtml(w, false); });
        html += '</div>';
      });
    }
    if (archiveList.length) {
      html += '<div class="wrong-group"><h3>已归档</h3>' +
        '<div class="wg-meta">独立做对的题收在这里，共 ' + archiveList.length + ' 道</div>';
      archiveList.slice(0, 20).forEach(function (w) { html += itemHtml(w, true); });
      html += '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------- 事件绑定 ---------- */
  function wrongAction(key, act, cause) {
    var w = wrongFind(key);
    if (!w) return false;
    if (act === 'cause') {
      if (!CAUSES[cause]) return false;
      w.cause = cause; wrongSave(); renderWrong();
      toast('已归类为「' + CAUSES[cause].label + '」');
    } else if (act === 'reveal') {
      S.wrongReveal[key] = true; renderWrong();
    } else if (act === 'rehide') {
      delete S.wrongReveal[key]; renderWrong();
    } else if (act === 'archive') {
      w.archived = true; delete S.wrongReveal[key]; wrongSave(); renderWrong();
      toast('已归档。下次可以在「显示已归档」里查看');
    } else if (act === 'unarchive') {
      w.archived = false; wrongSave(); renderWrong();
      toast('已恢复到待复盘');
    } else return false;
    return true;
  }
  document.addEventListener('click', function (e) {
    var n = e.target.closest('[data-nav]');
    if (n) { e.preventDefault(); nav(n.dataset.nav); }
    var wact = e.target.closest('[data-wact]');
    if (wact) {
      var item = wact.closest('.wrong-item');
      if (item) wrongAction(item.dataset.key, wact.dataset.wact, wact.dataset.cause);
    }
  });
  $('#btnStartDiag').onclick = startDiagnosis;
  $('#btnSubmit').onclick = submitQuiz;
  $('#btnNext').onclick = nextQuiz;
  $('#btnQuit').onclick = function () {
    $('#quizPanel').classList.add('hidden'); $('#setupPanel').classList.remove('hidden');
    STORE.del('session_' + S.subject); S.session = null; nav('diagnose');
  };
  $('#targetSearch').oninput = function () { S.diag.query = this.value; renderTargetResults(); };
  $('#optLimit').onchange = function () { S.diag.limit = Number(this.value); saveDiagState(); };
  $('#optConfirm').onchange = function () { S.diag.confirm = Number(this.value); saveDiagState(); };
  $('#optMode').onchange = function () { S.diag.diagMode = this.value; saveDiagState(); };
  $('#btnAgain').onclick = function () { $('#setupPanel').classList.remove('hidden'); $('#quizPanel').classList.add('hidden'); nav('diagnose'); };
  $('#btnClearWrong').onclick = function () {
    if (!S.wrong.length) return;
    if (!confirm('确定清空全部错题记录？')) return;
    S.wrong = []; S.wrongReveal = {}; wrongSave(); renderWrong();
  };
  $('#btnToggleArchived').onclick = function () {
    S.wrongShowArchived = !S.wrongShowArchived;
    this.textContent = S.wrongShowArchived ? '隐藏已归档' : '显示已归档';
    renderWrong();
  };
  /* ---------- 图谱导出 ---------- */
  function exportScopeTopics() {
    if (!S.data) return [];
    var g = S.graph, scope = {}, topics = S.data.topics.filter(function (t) {
      if (S.exGrade && String(t.grade) !== String(S.exGrade)) return false;
      if (S.exQuery && t.name.indexOf(S.exQuery) < 0 && (t.description || '').indexOf(S.exQuery) < 0) return false;
      if (S.exChapter && chapterKey(t) !== S.exChapter) return false;
      return true;
    });
    topics.forEach(function (t) { scope[t.id] = 1; });
    return { topics: topics, scope: scope, graph: g };
  }
  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function safeLabel(s) { return String(s || '').replace(/["\]\n\r]/g, ' '); }
  function exportMermaid() {
    needData(function () {
      var ex = exportScopeTopics(), topics = ex.topics, scope = ex.scope, g = ex.graph;
      if (!topics.length) { toast('当前范围没有知识点可导出'); return; }
      var m = SUBS[S.subject], lines = ['flowchart TD'];
      lines.push('  %% 知谱 · ' + m.name + '知识图谱 · 先修关系由 AI 整理且大量标注「待核」，正式教学使用前请教师审核');
      var chapters = {};
      topics.forEach(function (t) { (chapters[chapterKey(t)] = chapters[chapterKey(t)] || []).push(t); });
      Object.keys(chapters).forEach(function (ch, ci) {
        lines.push('  subgraph G' + ci + '["' + safeLabel(ch) + '"]');
        chapters[ch].forEach(function (t) { lines.push('    ' + t.id + '["' + safeLabel(t.name) + '"]'); });
        lines.push('  end');
      });
      topics.forEach(function (t) {
        (g.prereqs[t.id] || []).forEach(function (p) {
          if (!scope[p.id]) return;
          lines.push('  ' + p.id + ' -->|' + (p.strength === 'hard' ? '必会' : '有帮助') + '| ' + t.id);
        });
      });
      downloadText('知谱_' + m.name + '_图谱_' + topics.length + '点.mmd', lines.join('\n'), 'text/plain');
      toast('已导出 Mermaid（' + topics.length + ' 个知识点）');
    });
  }
  function exportMarkmap() {
    needData(function () {
      var ex = exportScopeTopics(), topics = ex.topics, scope = ex.scope, g = ex.graph;
      if (!topics.length) { toast('当前范围没有知识点可导出'); return; }
      var m = SUBS[S.subject], chapters = {};
      topics.forEach(function (t) { (chapters[chapterKey(t)] = chapters[chapterKey(t)] || []).push(t); });
      var lines = ['# ' + m.name + '知识图谱（' + topics.length + ' 个知识点）', '',
        '> 先修关系来自开源项目 cn-math-taxonomy，由 AI 整理且大量标注「待核」，正式教学使用前请教师审核。', ''];
      Object.keys(chapters).forEach(function (ch) {
        lines.push('## ' + ch.replace(/^#+\s*/, ''));
        chapters[ch].forEach(function (t) {
          lines.push('- ' + t.name + '（' + gradeLabel(t) + '）');
          var pre = (g.prereqs[t.id] || []).filter(function (p) { return scope[p.id]; })
            .map(function (p) { var pt = g.byId[p.id]; return (pt ? pt.name : p.id) + '[' + (p.strength === 'hard' ? '必会' : '有帮助') + ']'; });
          if (pre.length) lines.push('  - 先修：' + pre.join('、'));
        });
        lines.push('');
      });
      downloadText('知谱_' + m.name + '_图谱.markmap.md', lines.join('\n'), 'text/markdown');
      toast('已导出 Markmap（' + topics.length + ' 个知识点）');
    });
  }
  $('#btnExportMermaid').onclick = exportMermaid;
  $('#btnExportMarkmap').onclick = exportMarkmap;
  $('#btnExport').onclick = function () {
    if (!S.session) { toast('还没有诊断报告'); return; }
    var sum = E.summarize(S.graph, S.session), m = SUBS[S.subject];
    var lines = ['# 知谱诊断报告', '', '学科：' + m.name, '时间：' + new Date().toLocaleString(), '作答：' + sum.asked + ' 题', '',
      '## 概览', '已掌握 ' + sum.mastered.length + ' · 不稳 ' + sum.shaky.length + ' · 薄弱 ' + sum.weak.length + ' · 未测 ' + sum.untested.length, '',
      '## 根因', sum.roots.map(function (r) { return '- ' + ((S.graph.byId[r.id] || {}).name || r.id); }).join('\n') || '（无）', '',
      '## 补学路径', sum.path.map(function (p, i) { return (i + 1) + '. ' + ((S.graph.byId[p.id] || {}).name || p.id) + ' [' + p.status + ']'; }).join('\n') || '（无）'];
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = '知谱诊断报告_' + m.name + '_' + Date.now() + '.md'; a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ---------- 启动 ---------- */
  renderSubjectSwitch(); renderHome();
  loadSubject(S.subject);
  window.__zhipu = { S: S, E: E, nav: nav, loadSubject: loadSubject,
    renderWrong: renderWrong, enrichWrongGrades: enrichWrongGrades,
    renderDiagSetup: renderDiagSetup, renderTargetResults: renderTargetResults,
    wrongAction: wrongAction, wrongKey: wrongKey,
    exportMermaidText: function () {
      var ex = exportScopeTopics(), topics = ex.topics, scope = ex.scope, g = ex.graph;
      var m = SUBS[S.subject], lines = ['flowchart TD'];
      lines.push('  %% 知谱 · ' + m.name + ' · 待核');
      topics.forEach(function (t) {
        lines.push('  ' + t.id + '["' + safeLabel(t.name) + '"]');
        (g.prereqs[t.id] || []).forEach(function (p) {
          if (scope[p.id]) lines.push('  ' + p.id + ' -->|' + (p.strength === 'hard' ? '必会' : '有帮助') + '| ' + t.id);
        });
      });
      return { text: lines.join('\n'), count: topics.length, subject: m.name };
    } };
})();
