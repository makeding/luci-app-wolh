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
			uci.load('dhcp'),
			uci.load('wolh')
		]);
	},

	render: function(data) {
		var has_ewk = data[0],
		    has_wol = data[1],
		    hosts = data[2],
		    m, s, o;

		this.formdata.has_ewk = has_ewk;
		this.formdata.has_wol = has_wol;

		// Parse pinned hosts from wolh configuration
		var pinnedHosts = {};
		uci.sections('wolh', 'host', function(section) {
			if (section.mac && section.name) {
				pinnedHosts[section.mac] = {
					name: section.name,
					ip: section.ip || null
				};
			}
		});

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

		// Create pinned hosts cards container
		var pinnedHostsContainer = null;
		if (Object.keys(pinnedHosts).length > 0) {
			var pinnedList = Object.keys(pinnedHosts).map(function(mac) {
				return {
					mac: mac,
					name: pinnedHosts[mac].name,
					ip: pinnedHosts[mac].ip
				};
			});
			
			// Sort pinned hosts by name
			pinnedList.sort(function(a, b) {
				return a.name.localeCompare(b.name);
			});
			
			pinnedHostsContainer = E('div', { 'class': 'pinned-hosts-container' }, [
				E('div', { 'class': 'pinned-hosts-header' }, [
					E('h3', {}, [_('Pinned Hosts')]),
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'title': _('Edit pinned hosts'),
						'click': L.ui.createHandlerFn(this, 'handleEditPinnedHosts')
					}, [_('Edit')])
				]),
				E('div', { 'class': 'pinned-grid' }, 
					pinnedList.map(function(host) {
						return E('div', {
							'class': 'pinned-card',
							'data-mac': host.mac,
							'click': L.ui.createHandlerFn(this, function(mac, name, ev) {
								// Don't trigger wakeup if clicking on unpin button
								if (ev.target.classList.contains('unpin-btn')) return false;
								this.handleWakeup(mac, name, ev);
								return false;
							}, host.mac, host.name)
						}, [
							E('div', { 'class': 'host-info' }, [
								E('div', { 'class': 'host-name' }, [host.name]),
								host.ip ? E('div', { 'class': 'host-ip' }, [host.ip]) : null,
								E('div', { 'class': 'host-mac' }, [host.mac])
							].filter(function(el) { return el !== null; })),
							E('div', { 'class': 'wol-icon' }, ['▶']),
							E('div', {
								'class': 'unpin-btn',
								'title': _('Unpin this host'),
								'click': L.ui.createHandlerFn(this, function(mac, name, ip, ev) {
									ev.preventDefault();
									ev.stopPropagation();
									this.handleTogglePin(mac, name, ip, true);
									return false;
								}, host.mac, host.name, host.ip)
							}, ['📌'])
						]);
					}.bind(this))
				)
			]);
		}

		// Create host hints cards container
		var hostHintsContainer = null;
		var hostList = [];
		
		// Process host hints data
		L.sortedKeys(hosts).forEach(function(mac) {
			var host = hosts[mac];
			if (mac && host) {
				hostList.push({
					mac: mac,
					name: host.name || null,
					ip: (L.toArray(host.ipaddrs || host.ipv4)[0] || 
						 L.toArray(host.ip6addrs || host.ipv6)[0] || null)
				});
			}
		});
		
		// Sort by IP address
		hostList.sort(function(a, b) {
			var ipA = a.ip || '';
			var ipB = b.ip || '';
			
			// Handle IPv4 addresses for proper sorting
			if (ipA && ipB) {
				var partsA = ipA.split('.').map(function(n) { return parseInt(n, 10); });
				var partsB = ipB.split('.').map(function(n) { return parseInt(n, 10); });
				
				if (partsA.length === 4 && partsB.length === 4) {
					for (var i = 0; i < 4; i++) {
						if (partsA[i] !== partsB[i]) {
							return partsA[i] - partsB[i];
						}
					}
					return 0;
				}
			}
			
			// Fallback to string comparison
			return ipA.localeCompare(ipB);
		});

		if (hostList.length > 0) {
			hostHintsContainer = E('div', { 'class': 'host-hints-container' }, [
				E('h3', {}, [_('Discovered Hosts')]),
				E('div', { 'class': 'hosts-grid' }, 
					hostList.map(function(host) {
						var isPinned = pinnedHosts.hasOwnProperty(host.mac);
						return E('div', {
							'class': 'host-card',
							'data-mac': host.mac,
							'click': L.ui.createHandlerFn(this, function(mac, name, ev) {
								// Don't trigger wakeup if clicking on pin button
								if (ev.target.classList.contains('pin-btn')) return false;
								this.handleWakeup(mac, name, ev);
								return false;
							}, host.mac, host.name)
						}, [
							E('div', { 'class': 'host-info' }, [
								E('div', { 'class': 'host-name' }, [
									host.name || (host.ip || _('Unknown Host'))
								]),
								host.ip ? E('div', { 'class': 'host-ip' }, [host.ip]) : null,
								E('div', { 'class': 'host-mac' }, [host.mac])
							].filter(function(el) { return el !== null; })),
							E('div', { 'class': 'wol-icon' }, ['▶']),
							!isPinned ? E('div', {
								'class': 'pin-btn',
								'title': _('Pin this host'),
								'click': L.ui.createHandlerFn(this, function(mac, name, ip, ev) {
									ev.preventDefault();
									ev.stopPropagation();
									this.handleTogglePin(mac, name, ip, false);
									return false;
								}, host.mac, host.name || (host.ip || _('Unknown Host')), host.ip)
							}, ['📌']) : null
						].filter(function(el) { return el !== null; }));
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

		// Keep MAC input field for manual entry, but hide the dropdown options since we have cards
		o = s.option(form.Value, 'mac', _('Manual MAC Address'),
			_('Enter a custom MAC address to wake up (optional - you can also click on cards above)'));

		o.rmempty = true;
		o.placeholder = _('XX:XX:XX:XX:XX:XX');

		if (has_ewk) {
			o = s.option(form.Flag, 'broadcast', _('Send to broadcast address'));

			if (has_wol)
				o.depends('executable', '/usr/bin/etherwake');
		}

		// Add CSS styles if we have any containers
		if (staticLeases.length > 0 || hostList.length > 0 || Object.keys(pinnedHosts).length > 0) {
			document.head.appendChild(E('style', {}, [
				// Pinned hosts styles
				'.pinned-hosts-container { margin-bottom: 20px; }',
				'.pinned-hosts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }',
				'.pinned-hosts-container h3 { margin: 0; font-size: 16px; font-weight: bold; color: #2196F3; }',
				'.pinned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }',
				'.pinned-card { border: 1px solid #2196F3; border-radius: 8px; padding: 15px; position: relative; transition: all 0.3s ease; cursor: pointer; background: #E3F2FD; }',
				'.pinned-card:hover { box-shadow: 0 4px 12px rgba(33,150,243,0.3); background: #BBDEFB; transform: translateY(-2px); }',
				
				// Static leases styles
				'.static-leases-container { margin-bottom: 20px; }',
				'.static-leases-container h3 { margin-bottom: 15px; font-size: 16px; font-weight: bold; }',
				'.leases-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }',
				'.lease-card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; position: relative; transition: all 0.3s ease; cursor: pointer; background: #fff; }',
				'.lease-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: #f9f9f9; transform: translateY(-2px); }',
				'.lease-info { margin-right: 80px; }',
				'.lease-name { font-weight: bold; font-size: 16px; color: #333; margin-bottom: 5px; }',
				'.lease-ip { color: #666; font-size: 14px; margin-bottom: 3px; }',
				'.lease-mac { color: #888; font-size: 12px; font-family: monospace; }',
				
				// Host hints styles
				'.host-hints-container { margin-bottom: 20px; }',
				'.host-hints-container h3 { margin-bottom: 15px; font-size: 16px; font-weight: bold; }',
				'.hosts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }',
				'.host-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; position: relative; transition: all 0.3s ease; cursor: pointer; background: #fafafa; }',
				'.host-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: #f0f0f0; transform: translateY(-2px); }',
				'.host-info { margin-right: 80px; }',
				'.host-name { font-weight: bold; font-size: 16px; color: #333; margin-bottom: 5px; }',
				'.host-ip { color: #666; font-size: 14px; margin-bottom: 3px; }',
				'.host-mac { color: #888; font-size: 12px; font-family: monospace; }',
				
				// Common icon styles
				'.wol-icon { position: absolute; right: 15px; top: 50%; transform: translateY(-50%); font-size: 24px; color: #4CAF50; opacity: 0; transition: opacity 0.3s ease; }',
				'.lease-card:hover .wol-icon, .host-card:hover .wol-icon, .pinned-card:hover .wol-icon { opacity: 1; }',
				'.wol-icon:hover { color: #45a049; transform: translateY(-50%) scale(1.1); }',
				
				// Pin/Unpin button styles - positioned at card edge for mobile
				'.pin-btn, .unpin-btn { position: absolute; right: -12px; top: -12px; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; transition: all 0.3s ease; opacity: 1; box-shadow: 0 2px 6px rgba(0,0,0,0.2); z-index: 10; }',
				'.pin-btn { background: #FFC107; color: #333; border: 2px solid #fff; }',
				'.pin-btn:hover { background: #FFB300; transform: scale(1.1); box-shadow: 0 4px 8px rgba(0,0,0,0.3); }',
				'.unpin-btn { background: #2196F3; color: #fff; border: 2px solid #fff; }',
				'.unpin-btn:hover { background: #1976D2; transform: scale(1.1); box-shadow: 0 4px 8px rgba(0,0,0,0.3); }',
				
				// Dark mode styles
				'@media (prefers-color-scheme: dark) {',
				'  .pinned-hosts-container h3 { color: #64B5F6; }',
				'  .static-leases-container h3, .host-hints-container h3 { color: #e0e0e0; }',
				'  .pinned-card { background: rgba(33,150,243,0.12); border-color: rgba(33,150,243,0.5); }',
				'  .pinned-card:hover { background: rgba(33,150,243,0.2); }',
				'  .lease-card { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.2); }',
				'  .lease-card:hover { background: rgba(255,255,255,0.1); }',
				'  .host-card { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.15); }',
				'  .host-card:hover { background: rgba(255,255,255,0.08); }',
				'  .lease-name, .host-name { color: #e0e0e0; }',
				'  .lease-ip, .host-ip { color: #b0b0b0; }',
				'  .lease-mac, .host-mac { color: #909090; }',
				'  .pin-btn { background: rgba(255,193,7,0.9); border-color: rgba(255,255,255,0.3); }',
				'  .unpin-btn { background: rgba(33,150,243,0.9); border-color: rgba(255,255,255,0.3); }',
				'}',
				
				// LuCI dark theme specific overrides
				'[data-darkmode="true"] .pinned-hosts-container h3 { color: #64B5F6; }',
				'[data-darkmode="true"] .static-leases-container h3, [data-darkmode="true"] .host-hints-container h3 { color: #e0e0e0; }',
				'[data-darkmode="true"] .pinned-card { background: rgba(33,150,243,0.12); border-color: rgba(33,150,243,0.5); }',
				'[data-darkmode="true"] .pinned-card:hover { background: rgba(33,150,243,0.2); }',
				'[data-darkmode="true"] .lease-card { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.2); }',
				'[data-darkmode="true"] .lease-card:hover { background: rgba(255,255,255,0.1); }',
				'[data-darkmode="true"] .host-card { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.15); }',
				'[data-darkmode="true"] .host-card:hover { background: rgba(255,255,255,0.08); }',
				'[data-darkmode="true"] .lease-name, [data-darkmode="true"] .host-name { color: #e0e0e0; }',
				'[data-darkmode="true"] .lease-ip, [data-darkmode="true"] .host-ip { color: #b0b0b0; }',
				'[data-darkmode="true"] .lease-mac, [data-darkmode="true"] .host-mac { color: #909090; }',
				'[data-darkmode="true"] .pin-btn { background: rgba(255,193,7,0.9); border-color: rgba(255,255,255,0.3); }',
				'[data-darkmode="true"] .unpin-btn { background: rgba(33,150,243,0.9); border-color: rgba(255,255,255,0.3); }'
			]));
		}

		// Store containers for use in addFooter
		this.staticLeasesContainer = staticLeasesContainer;
		this.hostHintsContainer = hostHintsContainer;
		this.pinnedHostsContainer = pinnedHostsContainer;
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

	handleTogglePin: function(mac, name, ip, isPinned) {
		// Check if there are pending changes outside of wolh config
		return uci.changes().then((changes) => {
			var configNames = Object.keys(changes);
			var nonWolhChanges = configNames.filter(function(config) {
				return config !== 'wolh';
			});
			var hasWolhChanges = configNames.includes('wolh');
			
			if (nonWolhChanges.length > 0) {
				ui.addNotification(null, [
					E('p', [ _('Please save your Unsaved Changes first') ])
				]);
				return Promise.reject('Other changes pending');
			}
			
			// If there are wolh changes, wait 2 seconds before proceeding
			var delay = hasWolhChanges ? new Promise(function(resolve) {
				setTimeout(resolve, 2000);
			}) : Promise.resolve();
			
			return delay.then(function() {
				// Show loading modal
				var action = isPinned ? _('Unpinning host') : _('Pinning host');
				ui.showModal(action, [
					E('p', { 'class': 'spinning' }, [ _('Saving configuration…') ])
				]);

				if (isPinned) {
					// Find and remove the section
					uci.sections('wolh', 'host', function(section) {
						if (section.mac === mac) {
							uci.remove('wolh', section['.name']);
						}
					});
				} else {
					// Create new section in wolh config
					var sectionId = uci.add('wolh', 'host');
					uci.set('wolh', sectionId, 'mac', mac);
					uci.set('wolh', sectionId, 'name', name);
					if (ip) {
						uci.set('wolh', sectionId, 'ip', ip);
					}
				}
				
				return uci.save()
					.then(() => uci.apply())
					.then(() => {
						var checkChanges = function() {
							return uci.changes().then((changes) => {
								var configNames = Object.keys(changes);
								if (configNames.length === 0) {
									location.reload();
								} else {
									setTimeout(checkChanges, 400);
								}
							}).catch(() => {
								setTimeout(() => location.reload(), 2000);
							});
						};
						setTimeout(checkChanges, 1000);
					})
					.catch((err) => {
						ui.hideModal();
						var errorMsg = isPinned ? 
							_('Failed to unpin host: %s').format(err) : 
							_('Failed to pin host: %s').format(err);
						ui.addNotification(null, [
							E('p', [ errorMsg ])
						]);
					});
			});
		}).catch((err) => {
			if (err !== 'Other changes pending') {
				ui.addNotification(null, [
					E('p', [ _('Failed to check configuration status: %s').format(err) ])
				]);
			}
		});
	},

	handleEditPinnedHosts: function() {
		var pinnedHosts = [];
		
		// Load current pinned hosts
		uci.sections('wolh', 'host', function(section) {
			if (section.mac && section.name) {
				pinnedHosts.push({
					id: section['.name'],
					name: section.name,
					mac: section.mac,
					ip: section.ip || ''
				});
			}
		});
		
		// Sort by name
		pinnedHosts.sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});
		
		var modalContent = this.buildEditModal(pinnedHosts);
		
		ui.showModal(_('Edit Pinned Hosts'), [
			modalContent,
			E('div', { 'class': 'right modal-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, [_('Cancel')]),
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': L.ui.createHandlerFn(this, 'saveEditedHosts')
				}, [_('Save')])
			])
		]);
	},

	buildEditModal: function(pinnedHosts) {
		var container = E('div', { 'class': 'edit-hosts-container' });
		
		var table = E('table', { 'class': 'table cbi-section-table hosts-edit-table' }, [
			E('thead', {}, [
				E('tr', {}, [
					E('th', { 'style': 'width: 30%' }, [_('Name')]),
					E('th', { 'style': 'width: 35%' }, [_('MAC Address')]),
					E('th', { 'style': 'width: 25%' }, [_('IP Address')]),
					E('th', { 'style': 'width: 10%' }, [_('Action')])
				])
			]),
			E('tbody', { 'class': 'hosts-tbody' })
		]);
		
		var tbody = table.querySelector('.hosts-tbody');
		
		// Add existing hosts
		pinnedHosts.forEach(function(host, index) {
			tbody.appendChild(this.createHostEditRow(host, index));
		}.bind(this));
		
		// Add new host button
		var addButton = E('button', {
			'class': 'cbi-button cbi-button-add',
			'style': 'margin-top: 10px;',
			'click': function() {
				var newIndex = tbody.querySelectorAll('tr').length;
				var newHost = { id: '', name: '', mac: '', ip: '' };
				tbody.appendChild(this.createHostEditRow(newHost, newIndex));
			}.bind(this)
		}, [_('Add Host')]);
		
		container.appendChild(table);
		container.appendChild(addButton);
		
		return container;
	},

	createHostEditRow: function(host, index) {
		var row = E('tr', { 'class': 'cbi-section-table-row host-edit-row', 'data-index': index }, [
			E('td', {}, [
				E('input', {
					'type': 'text',
					'class': 'cbi-input-text host-name-input',
					'placeholder': _('Host name'),
					'value': host.name,
					'data-field': 'name'
				})
			]),
			E('td', {}, [
				E('input', {
					'type': 'text',
					'class': 'cbi-input-text host-mac-input',
					'placeholder': 'XX:XX:XX:XX:XX:XX',
					'value': host.mac,
					'data-field': 'mac',
					'pattern': '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
				})
			]),
			E('td', {}, [
				E('input', {
					'type': 'text',
					'class': 'cbi-input-text host-ip-input',
					'placeholder': '192.168.1.100',
					'value': host.ip,
					'data-field': 'ip'
				})
			]),
			E('td', {}, [
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': function() {
						row.remove();
					}
				}, [_('Delete')])
			])
		]);
		
		// Store original ID for updates
		row.setAttribute('data-original-id', host.id);
		
		return row;
	},

	saveEditedHosts: function() {
		var rows = document.querySelectorAll('.host-edit-row');
		var hosts = [];
		var errors = [];
		
		// Validate and collect data
		rows.forEach(function(row, index) {
			var nameInput = row.querySelector('.host-name-input');
			var macInput = row.querySelector('.host-mac-input');
			var ipInput = row.querySelector('.host-ip-input');
			
			var name = nameInput.value.trim();
			var mac = macInput.value.trim().toUpperCase();
			var ip = ipInput.value.trim();
			var originalId = row.getAttribute('data-original-id');
			
			// Validate required fields
			if (!name) {
				errors.push(_('Host name is required for entry %d').format(index + 1));
				nameInput.style.borderColor = '#ff0000';
			} else {
				nameInput.style.borderColor = '';
			}
			
			if (!mac) {
				errors.push(_('MAC address is required for entry %d').format(index + 1));
				macInput.style.borderColor = '#ff0000';
			} else if (!/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
				errors.push(_('Invalid MAC address format for entry %d').format(index + 1));
				macInput.style.borderColor = '#ff0000';
			} else {
				macInput.style.borderColor = '';
			}
			
			if (name && mac && /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
				hosts.push({
					originalId: originalId,
					name: name,
					mac: mac,
					ip: ip
				});
			}
		});
		
		if (errors.length > 0) {
			ui.addNotification(null, [
				E('p', [_('Please fix the following errors:')]),
				E('ul', {}, errors.map(function(error) {
					return E('li', {}, [error]);
				}))
			]);
			return;
		}
		
		// Show loading modal
		ui.showModal(_('Saving Changes'), [
			E('p', { 'class': 'spinning' }, [_('Updating pinned hosts configuration…')])
		]);
		
		// Remove all existing wolh host sections
		var sectionsToRemove = [];
		uci.sections('wolh', 'host', function(section) {
			sectionsToRemove.push(section['.name']);
		});
		
		sectionsToRemove.forEach(function(sectionName) {
			uci.remove('wolh', sectionName);
		});
		
		// Add new sections
		hosts.forEach(function(host) {
			var sectionId = uci.add('wolh', 'host');
			uci.set('wolh', sectionId, 'name', host.name);
			uci.set('wolh', sectionId, 'mac', host.mac);
			if (host.ip) {
				uci.set('wolh', sectionId, 'ip', host.ip);
			}
		});
		
		// Save and apply changes
		uci.save()
			.then(() => uci.apply())
			.then(() => {
				var checkChanges = function() {
					return uci.changes().then((changes) => {
						var configNames = Object.keys(changes);
						if (configNames.length === 0) {
							location.reload();
						} else {
							setTimeout(checkChanges, 400);
						}
					}).catch(() => {
						setTimeout(() => location.reload(), 2000);
					});
				};
				setTimeout(checkChanges, 1000);
			})
			.catch((err) => {
				ui.hideModal();
				ui.addNotification(null, [
					E('p', [_('Failed to save pinned hosts: %s').format(err)])
				]);
			});
	},

	addFooter: function() {
		var footer = E('div', { 'class': 'cbi-page-actions' }, [
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': L.ui.createHandlerFn(this, 'handleWakeup')
			}, [ _('Wake up host') ])
		]);

		var containers = [];
		
		if (this.pinnedHostsContainer) {
			containers.push(this.pinnedHostsContainer);
		}
		
		if (this.staticLeasesContainer) {
			containers.push(this.staticLeasesContainer);
		}
		
		if (this.hostHintsContainer) {
			containers.push(this.hostHintsContainer);
		}

		if (containers.length > 0) {
			return E('div', {}, [
				footer
			].concat(containers));
		}
		
		return footer;
	}
});
