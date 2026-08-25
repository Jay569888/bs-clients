window.AppsScriptService = (function() {
  async function request(params) {
    if (!window.SCRIPT_URL) throw new Error('Apps Script URL not configured');
    const res = await fetch(window.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'text/plain' }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }
  return {
    init: () => request({action:'init'}),
    getAll: () => request({action:'getAll'}),
    getMeta: () => request({action:'getMeta'}),
    addLead: (tab, lead) => request({action:'addLead', tab, lead}),
    updateLead: (tab, lead) => request({action:'updateLead', tab, lead}),
    deleteLead: (tab, id, lead) => request({action:'deleteLead', tab, id, lead}),
    moveLead: (from, to, id) => request({action:'moveLead', fromTab:from, toTab:to, id}),
    logEmail: (leadId, entry) => request({action:'logEmail', leadId, entry}),
    saveMeta: (data) => request({action:'saveMeta', ...data}),
    getGmailToken: () => request({action:'getGmailToken'}),
    getRetainerStats: () => request({action:'getRetainerStats'})
  };
})();