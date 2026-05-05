import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from './icons.jsx';

const SIDEBAR_LS_KEY = 'ledger_sidebar_collapsed';
const SIDEBAR_WIDTH = 220;
const SIDEBAR_RAIL = 48;
const MOBILE_BP = 768;

const NAV_ITEMS = [
  { id: 'overview',  label: 'Overview',        icon: 'grid' },
  { id: 'accounts',  label: 'Accounts',        icon: 'wallet' },
  { id: 'cashflow',  label: 'Cashflow',        icon: 'trendingUp', children: [
    { id: 'ive',        label: 'Income vs Expenses' },
    { id: 'categories', label: 'Categories' },
    { id: 'details',    label: 'Details' },
  ]},
  { id: 'passive',   label: 'Passive Income',  icon: 'percent' },
  { id: 'intake',    label: 'Intake',          icon: 'upload' },
];

function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_LS_KEY) === 'true'; } catch (_) { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BP);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= MOBILE_BP;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen(o => !o);
    } else {
      setCollapsed(c => {
        const next = !c;
        try { localStorage.setItem(SIDEBAR_LS_KEY, String(next)); } catch (_) {}
        return next;
      });
    }
  }, [isMobile]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { collapsed, mobileOpen, isMobile, toggle, setMobileOpen };
}

function Sidebar({ tab, section, onNavigate, sidebar, onOpenTweaks }) {
  const { collapsed, mobileOpen, isMobile, toggle, setMobileOpen } = sidebar;
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const groups = {};
    NAV_ITEMS.forEach(item => { if (item.children) groups[item.id] = true; });
    return groups;
  });

  const toggleGroup = (id) => {
    setExpandedGroups(g => ({ ...g, [id]: !g[id] }));
  };

  const handleNav = (tabId, sectionId) => {
    onNavigate(tabId, sectionId || null);
    if (isMobile) setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="sb" data-collapsed={collapsed && !isMobile ? '' : undefined}>
      <div className="sb-top">
        <nav className="sb-nav">
          {NAV_ITEMS.map(item => {
            const active = tab === item.id;
            const hasChildren = item.children && item.children.length > 0;
            const expanded = expandedGroups[item.id];
            const showChildren = hasChildren && expanded && !collapsed;

            return (
              <div key={item.id} className="sb-group">
                <button
                  className={`sb-item${active ? ' active' : ''}`}
                  onClick={() => handleNav(item.id, null)}
                  title={collapsed && !isMobile ? item.label : undefined}
                >
                  <span className="sb-item-icon"><Icon name={item.icon} size={18}/></span>
                  <span className="sb-item-label">{item.label}</span>
                  {hasChildren && !collapsed && (
                    <button
                      className="sb-chevron"
                      onClick={(e) => { e.stopPropagation(); toggleGroup(item.id); }}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14}/>
                    </button>
                  )}
                </button>
                {showChildren && (
                  <div className="sb-children">
                    {item.children.map(child => (
                      <button
                        key={child.id}
                        className={`sb-child${active && section === child.id ? ' active' : ''}`}
                        onClick={() => handleNav(item.id, child.id)}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
      <div className="sb-footer">
        <button
          className="sb-item"
          onClick={onOpenTweaks}
          title={collapsed && !isMobile ? 'Settings' : undefined}
        >
          <span className="sb-item-icon"><Icon name="settings" size={18}/></span>
          <span className="sb-item-label">Settings</span>
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {mobileOpen && (
          <div className="sb-overlay" onClick={() => setMobileOpen(false)}/>
        )}
        <div className={`sb-mobile${mobileOpen ? ' open' : ''}`}>
          {sidebarContent}
        </div>
      </>
    );
  }

  return sidebarContent;
}

export { NAV_ITEMS, Sidebar, useSidebar, SIDEBAR_WIDTH, SIDEBAR_RAIL };
