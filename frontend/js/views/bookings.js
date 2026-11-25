'use strict';
// Booking & Waitlist screens — owner: Youssef Amr Sayed (248183)
//  BookingActions.*   book / join waitlist (used by the timetable)
//  #/my-bookings      upcoming + past bookings, waitlist positions, notifications
(function () {
  const { h, toast, guard, statusBadge, table, fmtDateTime, errorNotice } = UI;
  window.Views = window.Views || {};

  window.BookingActions = {
    async myClassIds() {
      try {
        const [b, w] = await Promise.all([Api.get('bookings', '/api/bookings/mine'), Api.get('bookings', '/api/waitlist/mine')]);
        return { booked: new Set(b.bookings.filter((x) => x.status === 'CONFIRMED').map((x) => x.classId)), waiting: new Set(w.waitlist.map((x) => x.classId)) };
      } catch {
        return { booked: new Set(), waiting: new Set() };
      }
    },
    book(classId, button) {
      return guard(async () => {
        try {
          const res = await Api.post('bookings', '/api/bookings', { classId });
          if (res.warnings && res.warnings.length) toast(res.warnings[0]);
          return res;
        } catch (err) {
          if (err.code === 'CLASS_FULL' && confirm('This class just filled up. Join the waitlist instead?')) {
            return BookingActions.joinWaitlist(classId);
          }
          throw err;
        }
      }, { button, okMessage: 'Place booked' });
    },
    joinWaitlist(classId, button) {
      return guard(async () => {
        const res = await Api.post('bookings', '/api/waitlist', { classId });
        toast(`You are number ${res.entry.position} on the waitlist`);
        return res;
      }, { button });
    },
  };

  Views.myBookings = {
    title: 'My bookings', roles: ['member'],
    async render(root) {
      let tab = 'upcoming';
      const tabs = h('div', { class: 'tabs' });
      const area = h('div', { class: 'card' });
      const load = async () => {
        tabs.replaceChildren(...[['upcoming', 'Upcoming'], ['past', 'History'], ['waitlist', 'Waitlist'], ['notifications', 'Notifications']]
          .map(([k, label]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; load(); } }, label)));
        area.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
        try {
          if (tab === 'waitlist') {
            const res = await Api.get('bookings', '/api/waitlist/mine');
            area.replaceChildren(table([
              { label: 'Class', key: 'classTitle' },
              { label: 'When', render: (w) => fmtDateTime(w.classStart) },
              { label: 'Position', render: (w) => `${w.position} of ${w.queueLength}` },
              { label: '', render: (w) => h('button', { class: 'small secondary', onclick: (e) => guard(() => Api.del('bookings', `/api/waitlist/${w.classId}`), { button: e.currentTarget, okMessage: 'Removed from waitlist' }).then(load).catch(() => {}) }, 'Leave') },
            ], res.waitlist, 'You are not on any waitlist.'));
          } else if (tab === 'notifications') {
            const res = await Api.get('bookings', '/api/notifications/mine');
            area.replaceChildren(table([
              { label: 'When', render: (n) => fmtDateTime(n.createdAt) },
              { label: 'Update', render: (n) => h('div', {}, h('strong', {}, n.title), h('div', { class: 'meta' }, n.message)) },
              { label: 'Email', render: (n) => statusBadge(n.emailStatus) },
            ], res.notifications, 'No notifications yet.'));
          } else {
            const res = await Api.get('bookings', '/api/bookings/mine');
            const now = Date.now();
            const rows = res.bookings.filter((b) => (tab === 'upcoming' ? new Date(b.classStart) > now && b.status === 'CONFIRMED' : !(new Date(b.classStart) > now && b.status === 'CONFIRMED')));
            if (tab === 'upcoming') rows.sort((a, b) => a.classStart.localeCompare(b.classStart));
            area.replaceChildren(
              tab === 'upcoming' ? h('p', { class: 'meta' }, 'Cancelling less than 2 hours before the class counts as a late cancellation (a strike). Three strikes in 30 days pause new bookings for 7 days.') : null,
              table([
                { label: 'Class', key: 'classTitle' },
                { label: 'When', render: (b) => fmtDateTime(b.classStart) },
                { label: 'Status', render: (b) => h('span', {}, statusBadge(b.status), b.source === 'WAITLIST' ? h('span', { class: 'meta' }, ' from waitlist') : null) },
                { label: '', render: (b) => (tab === 'upcoming' ? h('div', { class: 'actions' },
                  h('a', { class: 'btn small secondary', href: `#/check-in/${b.classId}` }, 'Check in'),
                  h('button', { class: 'small danger', onclick: (e) => cancel(b, e.currentTarget, load) }, 'Cancel')) : '') },
              ], rows, tab === 'upcoming' ? 'No upcoming bookings. Find a class in the timetable.' : 'No past bookings.'));
          }
        } catch (err) {
          area.replaceChildren(errorNotice(err));
        }
      };
      root.append(h('h1', {}, 'My bookings'), h('p', { class: 'lead' }, 'Your places, waitlists and messages from the gym.'), tabs, area);
      await load();
    },
  };

  async function cancel(b, button, reload) {
    const hours = (new Date(b.classStart) - Date.now()) / 3600000;
    const warn = hours < 2 ? '\n\nThis is less than 2 hours before the class and will count as a late cancellation.' : '';
    if (!confirm(`Cancel your place in ${b.classTitle}?${warn}`)) return;
    await guard(async () => {
      const res = await Api.del('bookings', `/api/bookings/${encodeURIComponent(b.bookingId)}`);
      toast(res.lateCancellation ? 'Cancelled (late cancellation recorded)' : 'Booking cancelled');
      if (res.promotedFromWaitlist) toast('Your place was given to the next member on the waitlist');
    }, { button }).then(reload).catch(() => {});
  }

  // Roster helper used by the attendance sheet (staff)
  window.BookingRoster = (classId) => Api.get('bookings', `/api/bookings${Api.qs({ classId })}`);
}());
