// Main menu routing: #ant-sort, #castle-defender, #water-sort, #bike-race (or #bike-race/CODE to join a room), or the menu.
window.GameHub = {
  route() {
    const h = location.hash.slice(1);
    const game = h === 'ant-sort' ? 'ant' : h === 'castle-defender' ? 'castle' : h === 'water-sort' ? 'ws' : (h === 'bike-race' || h.startsWith('bike-race/')) ? 'br' : 'menu';
    document.getElementById('hub').hidden = game !== 'menu';
    document.getElementById('app').hidden = game !== 'ant';
    document.getElementById('cd-app').hidden = game !== 'castle';
    document.getElementById('ws-app').hidden = game !== 'ws';
    document.getElementById('br-app').hidden = game !== 'br';
    if (game === 'ws') window.WaterSort && window.WaterSort.show();
    else window.WaterSort && window.WaterSort.hide();
    if (game === 'castle') window.CastleDefender && window.CastleDefender.show();
    else window.CastleDefender && window.CastleDefender.hide();
    if (game === 'br') window.BikeRace && window.BikeRace.show();
    else window.BikeRace && window.BikeRace.hide();
    if (game === 'ant') window.dispatchEvent(new CustomEvent('game:show', { detail: 'ant' }));
  },
  open(name) { if (location.hash.slice(1) === name) this.route(); else location.hash = name; },
  menu() {
    if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
    this.route();
  },
};
document.getElementById('app').hidden = true;
