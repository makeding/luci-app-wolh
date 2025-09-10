'use strict';
'require view';
'require dom';
'require uci';
'require fs';
'require ui';
'require rpc';
'require form';
'require tools.widgets as widgets';

return view.extend({
	formdata: { wol: {} },

	callHostHints: rpc.declare({
		object: 'luci-rpc',
		method: 'getHostHints',
		expect: { '': {} }
	}),

	load: function() {
		return Promise.all([
			L.resolveDefault(fs.stat('/usr/bin/etherwake')),
			L.resolveDefault(fs.stat('/usr/bin/wol')),
			this.callHostHints(),
			uci.load('etherwake'),
			uci.load('dhcp')
		]);
	},

	render: function(data) {
		var has_ewk = data[0],
		    has_wol = data[1],
		    hosts = data[2],
		    m, s, o;

		this.formdata.has_ewk = has_ewk;
		this.formdata.has_wol = has_wol;

		// Parse static leases from DHCP configuration
		var staticLeases = [];
		uci.sections('dhcp', 'host', function(section) {
			if (section.name && section.ip && section.mac) {
				// Handle both single MAC and list of MACs
				var macs = Array.isArray(section.mac) ? section.mac : [section.mac];
				macs.forEach(function(mac) {
					staticLeases.push({
						name: section.name,
						ip: section.ip,
						mac: mac.toUpperCase()
					});
				});
			}
		});

		// Create static leases cards container
		var staticLeasesContainer = null;
		if (staticLeases.length > 0) {
			staticLeasesContainer = E('div', { 'class': 'static-leases-container' }, [
				E('h3', {}, [_('Static Leases')]),
				E('div', { 'class': 'leases-grid' }, 
					staticLeases.map(function(lease) {
						return E('div', {
							'class': 'lease-card',
							'data-mac': lease.mac,
							'click': L.ui.createHandlerFn(this, function(mac, name, ev) {
								this.handleWakeup(mac, name, ev);
								return false;
							}, lease.mac, lease.name)
						}, [
							E('div', { 'class': 'lease-info' }, [
								E('div', { 'class': 'lease-name' }, [lease.name]),
								E('div', { 'class': 'lease-ip' }, [lease.ip]),
								E('div', { 'class': 'lease-mac' }, [lease.mac])
							]),
							E('div', { 'class': 'wol-icon' }, ['▶'])
						]);
					}.bind(this))
				)
			]);
		}

		m = new form.JSONMap(this.formdata, _('Wake on LAN H'),
			_('Wake on LAN is a mechanism to boot computers remotely in the local network.'));

		s = m.section(form.NamedSection, 'wol');

		if (has_ewk && has_wol) {
			o = s.option(form.ListValue, 'executable', _('WoL program'),
				_('Sometimes only one of the two tools works. If one fails, try the other one'));

			o.value('/usr/bin/etherwake', 'Etherwake');
			o.value('/usr/bin/wol', 'WoL');
		}

		if (has_ewk) {
			o = s.option(widgets.DeviceSelect, 'iface', _('Network interface to use'),
				_('Specifies the interface the WoL packet is sent on'));

			o.rmempty = true;
			o.noaliases = true;
			o.noinactive = true;

			uci.sections('etherwake', 'target', function(section) {
				if (section.mac && section.name) {
					// Create a host entry if it doesn't exist
					if (!hosts[section.mac]) {
						hosts[section.mac] = { name: section.name };
					}
				}
			});

			if (has_wol)
				o.depends('executable', '/usr/bin/etherwake');
		}

		o = s.option(form.Value, 'mac', _('Host to wake up'),
			_('Choose the host to wake up or enter a custom MAC address to use'));

		o.rmempty = false;

		L.sortedKeys(hosts).forEach(function(mac) {
			o.value(mac, E([], [ mac, ' (', E('strong', [
				hosts[mac].name ||
				L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4)[0] ||
				L.toArray(hosts[mac].ip6addrs || hosts[mac].ipv6)[0] ||
				'?'
			]), ')' ]));
		});

		if (has_ewk) {
			o = s.option(form.Flag, 'broadcast', _('Send to broadcast address'));

			if (has_wol)
				o.depends('executable', '/usr/bin/etherwake');
		}

		// Add CSS styles if we have static leases
		if (staticLeases.length > 0) {
			document.head.appendChild(E('style', {}, [
				'.static-leases-container { margin-bottom: 20px; }',
				'.static-leases-container h3 { margin-bottom: 15px; font-size: 16px; font-weight: bold; }',
				'.leases-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }',
				'.lease-card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; position: relative; transition: all 0.3s ease; cursor: pointer; background: #fff; }',
				'.lease-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: #f9f9f9; transform: translateY(-2px); }',
				'.lease-info { margin-right: 40px; }',
				'.lease-name { font-weight: bold; font-size: 16px; color: #333; margin-bottom: 5px; }',
				'.lease-ip { color: #666; font-size: 14px; margin-bottom: 3px; }',
				'.lease-mac { color: #888; font-size: 12px; font-family: monospace; }',
				'.wol-icon { position: absolute; right: 15px; top: 50%; transform: translateY(-50%); font-size: 24px; color: #4CAF50; opacity: 0; transition: opacity 0.3s ease; }',
				'.lease-card:hover .wol-icon { opacity: 1; }',
				'.wol-icon:hover { color: #45a049; transform: translateY(-50%) scale(1.1); }'
			]));
		}

		// Store staticLeasesContainer for use in addFooter
		this.staticLeasesContainer = staticLeasesContainer;
		return m.render();
	},

	handleWakeup: function(mac, name, ev) {
		var data = this.formdata;
		
		if (ev) {
			ev.preventDefault();
			ev.stopPropagation();
		}

		// Validate MAC address early if provided
		if (mac && !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
			ui.addNotification(null, [
				E('p', [ _('Invalid MAC address!') ])
			]);
			return;
		}

		var executeWakeup = function(targetMac, targetName) {
			var bin = data.executable || (data.has_ewk ? '/usr/bin/etherwake' : '/usr/bin/wol');
			var args = [];

			if (bin == '/usr/bin/etherwake') {
				args.push('-D');
				
				if (data.wol && data.wol.iface) {
					args.push('-i', data.wol.iface);
				}

				if (data.wol && data.wol.broadcast == '1') {
					args.push('-b');
				}

				args.push(targetMac);
			} else {
				args.push('-v', targetMac);
			}

			var loadingMsg = targetName ? 
				_('Waking %s (%s)…').format(targetName, targetMac) : 
				_('Starting WoL utility…');
			
			ui.showModal(_('Waking host'), [
				E('p', { 'class': 'spinning' }, [ loadingMsg ])
			]);

			return fs.exec(bin, args).then(function(res) {
				var successMsg = targetName ? 
					_('Successfully sent wake packet to %s').format(targetName) : 
					_('Wake packet sent');
					
				ui.showModal(_('Waking host'), [
					E('p', [ successMsg ]),
					res.stdout ? E('pre', [ res.stdout ]) : '',
					res.stderr ? E('pre', [ res.stderr ]) : '',
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'cbi-button cbi-button-primary',
							'click': ui.hideModal
						}, [ _('Dismiss') ])
					])
				]);
			}).catch(function(err) {
				ui.hideModal();
				var errorMsg = targetName ? 
					_('Failed to wake %s: %s').format(targetName, err) : 
					_('Waking host failed: ') + err;
				ui.addNotification(null, [
					E('p', [ errorMsg ])
				]);
			});
		}.bind(this);

		if (mac) {
			return executeWakeup(mac, name);
		} else {
			var map = document.querySelector('#maincontent .cbi-map');
			return dom.callClassMethod(map, 'save').then(function() {
				if (!data.wol.mac)
					return alert(_('No target host specified!'));
				
				return executeWakeup(data.wol.mac);
			});
		}
	},

	addFooter: function() {
		var footer = E('div', { 'class': 'cbi-page-actions' }, [
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': L.ui.createHandlerFn(this, 'handleWakeup')
			}, [ _('Wake up host') ])
		]);

		if (this.staticLeasesContainer) {
			return E('div', {}, [
				footer,
				this.staticLeasesContainer
			]);
		}
		return footer;
	}
});
