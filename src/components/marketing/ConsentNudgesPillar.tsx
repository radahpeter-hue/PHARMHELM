import React, { useState, useEffect } from 'react';
import { 
  Users, 
  MessageSquare, 
  ShieldCheck, 
  RefreshCw, 
  Send, 
  CheckCircle, 
  AlertTriangle,
  UserPlus,
  Trash2,
  FileSpreadsheet,
  Download
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { Client, HealthMessage, MessageQueueItem } from '../../types';
import { toast } from 'sonner';

interface ConsentNudgesPillarProps {
  tenantId: string;
  role: string;
}

export const ConsentNudgesPillar: React.FC<ConsentNudgesPillarProps> = ({ tenantId, role }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<HealthMessage[]>([]);
  const [queue, setQueue] = useState<MessageQueueItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'crm' | 'library' | 'queue'>('crm');
  
  // Library form state
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgTags, setMsgTags] = useState('All, Chronic');
  
  // New Client Form
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientChannel, setNewClientChannel] = useState<'SMS' | 'WhatsApp' | 'None'>('SMS');
  const [newClientTags, setNewClientTags] = useState('Hypertension');

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<Client>('clients', tenantId, setClients);
      firestoreService.subscribeToCollection<HealthMessage>('health_messages', tenantId, setMessages);
      firestoreService.subscribeToCollection<MessageQueueItem>('message_queue', tenantId, setQueue);
    }
  }, [tenantId]);

  const handleToggleConsent = async (client: Client) => {
    try {
      const updatedOptIn = !client.sms_opt_in;
      await firestoreService.updateDocument('clients', client.id, {
        sms_opt_in: updatedOptIn,
        sms_opt_in_date: updatedOptIn ? new Date().toISOString().split('T')[0] : null,
        sms_opt_in_logged_by: role
      });
      toast.success(`Consent ${updatedOptIn ? 'granted' : 'revoked'} for ${client.name}`);
    } catch {
      toast.error('Failed to update consent');
    }
  };

  const handleUpdatePreference = async (client: Client, channel: 'SMS' | 'WhatsApp' | 'None') => {
    try {
      await firestoreService.updateDocument('clients', client.id, {
        preferred_channel: channel
      });
      toast.success(`Preferred channel set to ${channel}`);
    } catch {
      toast.error('Failed to update channel');
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientPhone) return;
    try {
      await firestoreService.addDocument('clients', {
        tenantId,
        name: newClientName,
        phone: newClientPhone,
        type: 'individual',
        sms_opt_in: true,
        sms_opt_in_date: new Date().toISOString().split('T')[0],
        sms_opt_in_logged_by: role,
        preferred_channel: newClientChannel,
        segment_tags: newClientTags.split(',').map(t => t.trim()),
        loyalty_points: 0,
        balance: 0
      });
      toast.success('Client added to Marketing CRM');
      setNewClientName('');
      setNewClientPhone('');
    } catch {
      toast.error('Failed to add client');
    }
  };

  const handleCreateMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgTitle || !msgBody) return;
    try {
      await firestoreService.addDocument('health_messages', {
        tenantId,
        title: msgTitle,
        body: msgBody,
        targetSegmentTags: msgTags.split(',').map(t => t.trim()),
        plannedSendDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        status: 'Draft',
        createdBy: role
      });
      toast.success('Health Message drafted');
      setMsgTitle('');
      setMsgBody('');
    } catch {
      toast.error('Failed to draft message');
    }
  };

  const handleApproveMessage = async (msg: HealthMessage) => {
    try {
      await firestoreService.updateDocument('health_messages', msg.id, {
        status: 'Approved'
      });
      toast.success('Message Approved for Broadcast');
    } catch {
      toast.error('Failed to approve message');
    }
  };

  const handleScanChronicRefills = async () => {
    // Look at clients who have next_refill_due_date within next 7 days
    const dueClients = clients.filter(c => {
      if (!c.next_refill_due_date || !c.sms_opt_in) return false;
      const dueDate = new Date(c.next_refill_due_date);
      const diffMs = dueDate.getTime() - Date.now();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays >= -5 && diffDays <= 7;
    });

    if (dueClients.length === 0) {
      toast.info('No refill nudges are pending or due in this buffer cycle.');
      return;
    }

    let queuedCount = 0;
    for (const c of dueClients) {
      // Check if already in queue
      const alreadyQueued = queue.some(q => q.clientId === c.id && q.status === 'Pending');
      if (!alreadyQueued) {
        await firestoreService.addDocument('message_queue', {
          tenantId,
          recipientName: c.name,
          clientId: c.id,
          channel: c.preferred_channel || 'SMS',
          messagePreview: `Dear ${c.name}, your prescription refill is due on ${c.next_refill_due_date}. Please visit your pharmacy branch for pick up.`,
          scheduledDate: new Date().toISOString().split('T')[0],
          status: 'Pending'
        });
        queuedCount++;
      }
    }
    toast.success(`Scanned and added ${queuedCount} due refills to the Nudge dispatch queue.`);
  };

  // Bulk Dispatch
  const handleBulkDispatch = async () => {
    const pendingItems = queue.filter(q => q.status === 'Pending');
    if (pendingItems.length === 0) {
      toast.info('Queue has no pending messages to dispatch.');
      return;
    }

    // Download CSV
    const csvContent = "data:text/csv;charset=utf-8," 
      + ["Recipient,Channel,Message,Scheduled Date"].join(",") + "\n"
      + pendingItems.map(item => `"${item.recipientName}","${item.channel}","${item.messagePreview}","${item.scheduledDate}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BULK_NUDGES_DISPATCH_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Update status to 'Sent' in Firestore
    for (const item of pendingItems) {
      await firestoreService.updateDocument('message_queue', item.id, {
        status: 'Sent'
      });
    }
    toast.success(`Dispatched ${pendingItems.length} messages. CSV generated for gateway upload!`);
  };

  const isHeadOrCEO = role === 'Marketing Head' || role === 'CEO' || role === 'admin';

  return (
    <div className="space-y-6">
      {/* Sub tabs */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveSubTab('crm')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'crm' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Users size={16} /> Marketing CRM & Consent
        </button>
        <button
          onClick={() => setActiveSubTab('library')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'library' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <RefreshCw size={16} /> Health Content Library
        </button>
        <button
          onClick={() => setActiveSubTab('queue')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'queue' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Send size={16} /> Nudge & SMS Sending Queue
        </button>
      </div>

      {activeSubTab === 'crm' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Client Contact Consent & Preferences</h3>
                <p className="text-zinc-500 text-xs">Verify consent levels and tags for legal digital notifications.</p>
              </div>
              <button
                onClick={handleScanChronicRefills}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5"
              >
                <RefreshCw size={14} /> Scan Refills Schedule
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-600">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Consent Status</th>
                    <th className="px-4 py-3">Preference</th>
                    <th className="px-4 py-3">Due Refill</th>
                    <th className="px-4 py-3">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {clients.map(c => (
                    <tr key={c.id} className="hover:bg-zinc-50/55 transition-colors">
                      <td className="px-4 py-3 font-semibold text-zinc-900">
                        {c.name}
                        <div className="text-[10px] text-zinc-400">{c.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleConsent(c)}
                          className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase tracking-wider flex items-center gap-1 ${
                            c.sms_opt_in 
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
                              : 'bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          {c.sms_opt_in ? <ShieldCheck size={12} /> : null}
                          {c.sms_opt_in ? 'Opted In' : 'Opted Out'}
                        </button>
                        {c.sms_opt_in && (
                          <div className="text-[9px] text-zinc-400 mt-0.5">By {c.sms_opt_in_logged_by || 'system'}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={c.preferred_channel || 'SMS'}
                          onChange={(e) => handleUpdatePreference(c, e.target.value as any)}
                          className="px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-[11px] font-semibold"
                        >
                          <option value="SMS">SMS Gateway</option>
                          <option value="WhatsApp">WhatsApp</option>
                          <option value="None">No Contact</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-800">
                        {c.next_refill_due_date ? (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg font-mono">
                            {c.next_refill_due_date}
                          </span>
                        ) : (
                          <span className="text-zinc-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(c.segment_tags || ['Unassigned']).map((t, i) => (
                            <span key={i} className="bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Client Panel */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
            <div>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight flex items-center gap-2">
                <UserPlus size={16} /> Enroll Lead or Patient
              </h4>
              <p className="text-zinc-500 text-xs mt-1">Direct manual enlistment in the patient loyalty/marketing log.</p>
            </div>

            <form onSubmit={handleAddClient} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Full Name</label>
                <input required type="text" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Kasozi Abraham" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Phone (with country code)</label>
                <input required type="text" value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="256701000000" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Preferred Gateway Channel</label>
                <select value={newClientChannel} onChange={e => setNewClientChannel(e.target.value as any)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs">
                  <option value="SMS">SMS Gateway</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="None">None</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Segment Tags (comma separated)</label>
                <input type="text" value={newClientTags} onChange={e => setNewClientTags(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Chronic, Asthma" />
              </div>

              <button type="submit" className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all">
                Create & Opt-In
              </button>
            </form>
          </div>
        </div>
      )}

      {activeSubTab === 'library' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Library log */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Approved Health content and templates</h3>
              <p className="text-zinc-500 text-xs">Maintain disease-specific health campaign triggers for CRM outreach.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {messages.length === 0 && (
                <div className="p-8 border border-dashed border-zinc-200 rounded-2xl text-center col-span-2 text-zinc-400 text-xs">
                  No custom messages defined. Try creating some!
                </div>
              )}
              {messages.map(m => (
                <div key={m.id} className="border border-zinc-100 rounded-2xl p-4 bg-zinc-50/50 space-y-2 relative">
                  <span className={`absolute top-3 right-3 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    m.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {m.status}
                  </span>
                  <h4 className="font-bold text-zinc-950 text-sm pr-16">{m.title}</h4>
                  <p className="text-zinc-600 text-xs line-clamp-3">{m.body}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {m.targetSegmentTags.map((t, i) => (
                      <span key={i} className="text-[9px] font-bold bg-white border border-zinc-200 text-zinc-500 px-1 py-0.5 rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                  {m.status !== 'Approved' && (
                    <button
                      disabled={role === 'Marketing Personnel'}
                      onClick={() => handleApproveMessage(m)}
                      className={`w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-bold text-[10px] uppercase tracking-wider rounded-lg transition-all mt-2`}
                    >
                      {role === 'Marketing Personnel' ? 'Awaiting Head Approval' : 'Approve message'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Draft Message Panel */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
            <div>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight">Draft SMS Broadcast</h4>
              <p className="text-zinc-500 text-xs mt-1">Input text templates targeting custom therapeutic segments.</p>
            </div>

            <form onSubmit={handleCreateMessage} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Message Header / Name</label>
                <input required type="text" value={msgTitle} onChange={e => setMsgTitle(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Diabetes Management Tips" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">SMS Body Content</label>
                <textarea required rows={4} value={msgBody} onChange={e => setMsgBody(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs resize-none" placeholder="Dear patient, remember to check your morning fasting levels and register them. Regular intake prevents secondary kidney disease." />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Target Patient Segments (commas)</label>
                <input type="text" value={msgTags} onChange={e => setMsgTags(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Diabetes, Chronic, Insulin" />
              </div>

              <button type="submit" className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all">
                Draft for Review
              </button>
            </form>
          </div>
        </div>
      )}

      {activeSubTab === 'queue' && (
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Bulk Notification dispatch Gateway</h3>
              <p className="text-zinc-500 text-xs">Review pending custom scheduled text reminders. Generate bulk gateway uploads.</p>
            </div>
            
            <button
              onClick={handleBulkDispatch}
              disabled={queue.filter(q => q.status === 'Pending').length === 0}
              className="bg-zinc-950 text-white disabled:bg-zinc-300 disabled:cursor-not-allowed hover:bg-zinc-850 px-5 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2"
            >
              <Download size={14} /> Download CSV & Dispatch Bulk
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                  <th className="px-4 py-3">Recipient Name</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Message Preview</th>
                  <th className="px-4 py-3">Send Date</th>
                  <th className="px-4 py-3">Dispatch status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium">
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-zinc-400 font-normal">
                      Queue is currently empty. Run "Scan Refills Schedule" to generate automatic reminders.
                    </td>
                  </tr>
                ) : (
                  queue.map(q => (
                    <tr key={q.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-zinc-900">{q.recipientName}</td>
                      <td className="px-4 py-3">
                        <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded text-[10px] font-bold">
                          {q.channel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 font-normal max-w-sm truncate">{q.messagePreview}</td>
                      <td className="px-4 py-3 font-mono">{q.scheduledDate}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase tracking-wider ${
                          q.status === 'Sent' ? 'bg-emerald-50 text-emerald-700' :
                          q.status === 'Pending' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        }`}>
                          {q.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
