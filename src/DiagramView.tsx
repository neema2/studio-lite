import { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import type { DiagramData, DiagramClass } from './lspClient';

// Domain color palette (dark theme friendly)
const DOMAIN_COLORS: Record<string, string> = {
  'RefData': '#6366f1',
  'Products': '#8b5cf6',
  'Trading': '#ec4899',
  'Positions': '#f97316',
  'PnL': '#22c55e',
  'Risk': '#ef4444',
  'Organization': '#0ea5e9',
  'Sales': '#14b8a6',
  'Operations': '#f59e0b',
  'Collateral': '#a855f7',
  'MarketData': '#06b6d4',
  'Regulatory': '#d946ef',
  'Funding': '#84cc16',
};

const DEFAULT_COLOR = '#64748b';

function getDomainColor(domain: string): string {
  if (!domain) return DEFAULT_COLOR;
  for (const [key, color] of Object.entries(DOMAIN_COLORS)) {
    if (domain.toLowerCase().includes(key.toLowerCase())) return color;
  }
  // Hash-based color for unknown domains
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

interface DiagramViewProps {
  data: DiagramData | null;
  isLoading: boolean;
}

export default function DiagramView({ data, isLoading }: DiagramViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedClass, setSelectedClass] = useState<DiagramClass | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [showAllDomains, setShowAllDomains] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Get all unique domains
  const allDomains = data
    ? [...new Set(data.classes.map(c => c.businessDomain || c.package || 'other'))]
        .filter(Boolean)
        .sort()
    : [];

  const buildGraph = useCallback(() => {
    if (!containerRef.current || !data || data.classes.length === 0) return;

    // Destroy previous instance
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    console.log(`[Diagram] Building graph: ${data.classes.length} classes, ${data.associations.length} assocs`);

    try {

    const elements: cytoscape.ElementDefinition[] = [];
    const isLargeModel = data.classes.length > 20;

    // Determine which classes to show based on filters
    const visibleClassIds = new Set<string>();
    for (const cls of data.classes) {
      const domain = cls.businessDomain || cls.package || 'other';
      const matchesSearch = !searchQuery ||
        cls.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cls.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cls.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDomain = showAllDomains || domainFilter.has(domain);
      if (matchesSearch && matchesDomain) {
        visibleClassIds.add(cls.id);
        visibleClassIds.add(cls.name);
      }
    }

    // Add domain compound nodes (only for small models — COSE chokes on compound nodes at scale)
    if (!isLargeModel) {
      const activeDomains = new Set<string>();
      for (const cls of data.classes) {
        if (visibleClassIds.has(cls.id)) {
          const domain = cls.businessDomain || cls.package || 'other';
          activeDomains.add(domain);
        }
      }
      for (const domain of activeDomains) {
        elements.push({
          group: 'nodes',
          data: {
            id: `domain::${domain}`,
            label: domain,
            type: 'domain',
          },
        });
      }
    }

    // Add class nodes
    for (const cls of data.classes) {
      if (!visibleClassIds.has(cls.id)) continue;
      const domain = cls.businessDomain || cls.package || 'other';
      const color = getDomainColor(domain);
      const stereotype = cls.stereotype ? `«${cls.stereotype}»` : '';
      const propCount = cls.properties.length;

      // Build multi-line label: ClassName\n───\nprop: Type[mult]
      // Cap displayed properties for large models to keep layout fast
      const maxProps = data.classes.length > 20 ? 5 : 20;
      const shownProps = cls.properties.slice(0, maxProps);
      const hiddenCount = cls.properties.length - shownProps.length;

      let label = cls.name;
      if (shownProps.length > 0) {
        label += '\n' + '─'.repeat(Math.max(cls.name.length, 10));
        for (const p of shownProps) {
          label += `\n${p.name}: ${p.type}${p.multiplicity}`;
        }
        if (hiddenCount > 0) {
          label += `\n  + ${hiddenCount} more`;
        }
      }

      const displayedLines = shownProps.length + (hiddenCount > 0 ? 1 : 0);
      const nodeHeight = 20 + (shownProps.length > 0 ? 12 : 0) + displayedLines * 13 + 16;

      elements.push({
        group: 'nodes',
        data: {
          id: cls.id,
          label,
          stereotype,
          propCount,
          domain,
          color,
          nodeHeight: Math.max(nodeHeight, 36),
          ...(isLargeModel ? {} : { parent: `domain::${domain}` }),
          classData: cls,
        },
      });
    }

    // Add association edges — bi-directional labels
    // sourceProperty navigates FROM source TO target → show near target end
    // targetProperty navigates FROM target TO source → show near source end
    for (const assoc of data.associations) {
      const sourceId = visibleClassIds.has(assoc.source) ? assoc.source : null;
      const targetId = visibleClassIds.has(assoc.target) ? assoc.target : null;
      if (sourceId && targetId) {
        elements.push({
          group: 'edges',
          data: {
            id: `assoc::${assoc.name}`,
            source: assoc.source,
            target: assoc.target,
            sourceLabel: `${assoc.targetProperty} ${assoc.targetMult}`,
            targetLabel: `${assoc.sourceProperty} ${assoc.sourceMult}`,
            type: 'association',
            assocSource: assoc.source,
            assocTarget: assoc.target,
          },
        });
      }
    }

    // Add generalisation edges
    for (const gen of data.generalisations) {
      if (visibleClassIds.has(gen.child) && visibleClassIds.has(gen.parent)) {
        elements.push({
          group: 'edges',
          data: {
            id: `gen::${gen.child}::${gen.parent}`,
            source: gen.child,
            target: gen.parent,
            type: 'generalisation',
          },
        });
      }
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // Domain compound nodes
        {
          selector: 'node[type="domain"]',
          style: {
            'background-color': '#1a1a2e',
            'background-opacity': 0.6,
            'border-color': '#3f3f46',
            'border-width': 1,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '11px',
            'color': '#a1a1aa',
            'padding': '20px',
            'text-margin-y': -5,
            'shape': 'roundrectangle',
          },
        },
        // Class nodes — multi-line with properties
        {
          selector: 'node[type!="domain"]',
          style: {
            'background-color': '#2a2a3e',
            'border-color': 'data(color)',
            'border-width': 2,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '9px',
            'font-family': 'monospace, Menlo, Consolas, sans-serif',
            'color': '#e4e4e7',
            'width': 'label',
            'height': 'data(nodeHeight)',
            'padding': '8px',
            'shape': 'roundrectangle',
            'text-wrap': 'wrap',
            'text-max-width': '250px',
          },
        },
        // Selected node
        {
          selector: 'node:selected',
          style: {
            'border-color': '#ff69b4',
            'border-width': 3,
            'background-color': '#3a2a3e',
          },
        },
        // Hovered node
        {
          selector: 'node.hover',
          style: {
            'border-width': 3,
            'background-color': '#333348',
          },
        },
        // Association edges — bi-directional with labels at each end
        {
          selector: 'edge[type="association"]',
          style: {
            'width': 1.5,
            'line-color': '#4a4a5e',
            'target-arrow-color': '#4a4a5e',
            'target-arrow-shape': 'triangle',
            'source-arrow-color': '#4a4a5e',
            'source-arrow-shape': 'diamond',
            'curve-style': 'bezier',
            'source-label': 'data(sourceLabel)',
            'target-label': 'data(targetLabel)',
            'font-size': '8px',
            'color': '#a1a1aa',
            'source-text-offset': 30,
            'target-text-offset': 30,
            'source-text-margin-y': -10,
            'target-text-margin-y': -10,
            'text-background-color': '#1e1e1e',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'arrow-scale': 0.8,
          },
        },
        // Focused edge — show label near the clicked node, hide the other end
        {
          selector: 'edge.focus-source',
          style: {
            'source-label': 'data(sourceLabel)',
            'target-label': '',
          },
        },
        {
          selector: 'edge.focus-target',
          style: {
            'target-label': 'data(targetLabel)',
            'source-label': '',
          },
        },
        // Generalisation edges
        {
          selector: 'edge[type="generalisation"]',
          style: {
            'width': 1.5,
            'line-color': '#6366f1',
            'line-style': 'dashed',
            'target-arrow-color': '#6366f1',
            'target-arrow-shape': 'triangle',
            'target-arrow-fill': 'hollow',
            'curve-style': 'bezier',
            'arrow-scale': 1,
          },
        },
        // Highlighted edges
        {
          selector: 'edge.highlighted',
          style: {
            'width': 2.5,
            'line-color': '#ff69b4',
            'target-arrow-color': '#ff69b4',
            'z-index': 10,
          },
        },
        // Dimmed elements
        {
          selector: '.dimmed',
          style: {
            'opacity': 0.15,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => elements.length > 100 ? 20000 : 8000,
        idealEdgeLength: () => elements.length > 100 ? 200 : 120,
        edgeElasticity: () => elements.length > 100 ? 50 : 100,
        gravity: elements.length > 100 ? 0.1 : 0.25,
        numIter: elements.length > 100 ? 500 : 1000,
        padding: 50,
        nodeDimensionsIncludeLabels: true,
        componentSpacing: elements.length > 100 ? 120 : 80,
        fit: true,
      } as cytoscape.LayoutOptions,
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    // Click handler - show class details + directional edge labels
    cy.on('tap', 'node[type!="domain"]', (evt) => {
      const node = evt.target;
      const classData = node.data('classData') as DiagramClass;
      setSelectedClass(classData);

      // Highlight connected edges (include parent compound nodes so they don't dim)
      cy.elements().removeClass('highlighted dimmed focus-source focus-target');
      const connected = node.connectedEdges().connectedNodes();
      let neighborhood = node.connectedEdges().union(connected).union(node);
      // Add parent compound nodes for all neighborhood members
      neighborhood.forEach((ele: cytoscape.SingularElementReturnValue) => {
        const parent = ele.parent();
        if (parent && parent.length > 0) {
          neighborhood = neighborhood.union(parent);
        }
      });
      cy.elements().not(neighborhood).addClass('dimmed');
      node.connectedEdges().addClass('highlighted');

      // Show only the relevant directional label on each edge
      const nodeId = node.id();
      node.connectedEdges().forEach((edge: cytoscape.EdgeSingular) => {
        if (edge.data('assocSource') === nodeId) {
          edge.addClass('focus-source');  // this node is source → show target label (what it navigates to)
        } else {
          edge.addClass('focus-target');  // this node is target → show source label (what it navigates to)
        }
      });
    });

    // Click on background to deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedClass(null);
        cy.elements().removeClass('highlighted dimmed focus-source focus-target');
      }
    });

    // Hover effects
    cy.on('mouseover', 'node[type!="domain"]', (evt) => {
      evt.target.addClass('hover');
      containerRef.current!.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node[type!="domain"]', (evt) => {
      evt.target.removeClass('hover');
      containerRef.current!.style.cursor = 'default';
    });

    cyRef.current = cy;
    console.log(`[Diagram] Rendered ${elements.length} elements`);

    } catch (err) {
      console.error('[Diagram] Failed to build graph:', err);
    }
  }, [data, searchQuery, domainFilter, showAllDomains]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, []);

  const handleDomainToggle = (domain: string) => {
    setShowAllDomains(false);
    setDomainFilter(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      if (next.size === 0) {
        setShowAllDomains(true);
      }
      return next;
    });
  };

  const handleShowAll = () => {
    setShowAllDomains(true);
    setDomainFilter(new Set());
  };

  const handleFitView = () => {
    cyRef.current?.fit(undefined, 40);
  };

  const handleFullscreen = () => {
    setIsFullscreen(prev => !prev);
    // Re-fit after layout reflow
    setTimeout(() => cyRef.current?.fit(undefined, 40), 50);
  };

  if (isLoading) {
    return (
      <div className="diagram-container">
        <div className="diagram-loading">Loading diagram...</div>
      </div>
    );
  }

  if (!data || data.classes.length === 0) {
    return (
      <div className="diagram-container">
        <div className="diagram-empty">
          No classes found. Add Pure class definitions in the model editor.
        </div>
      </div>
    );
  }

  return (
    <div className={`diagram-container ${isFullscreen ? 'diagram-fullscreen' : ''}`}>
      {/* Toolbar */}
      <div className="diagram-toolbar">
        <input
          type="text"
          className="diagram-search"
          placeholder="Search classes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button className="diagram-btn" onClick={handleFitView} title="Fit to view">
          ⊞
        </button>
        <button className="diagram-btn" onClick={handleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '✖' : '⛶'}
        </button>
        <div className="diagram-stats">
          {data.classes.length} classes · {data.associations.length} assoc
        </div>
      </div>

      {/* Domain filter chips */}
      <div className="diagram-domains">
        <button
          className={`domain-chip ${showAllDomains ? 'active' : ''}`}
          onClick={handleShowAll}
        >
          All
        </button>
        {allDomains.map(d => (
          <button
            key={d}
            className={`domain-chip ${!showAllDomains && domainFilter.has(d) ? 'active' : ''}`}
            style={{
              borderColor: getDomainColor(d),
              ...((!showAllDomains && domainFilter.has(d)) ? { backgroundColor: getDomainColor(d) + '30' } : {}),
            }}
            onClick={() => handleDomainToggle(d)}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Graph + Detail split */}
      <div className="diagram-body">
        <div ref={containerRef} className="diagram-canvas" />

        {/* Property panel */}
        {selectedClass && (
          <div className="diagram-detail">
            <div className="detail-header">
              <span className="detail-class-name">{selectedClass.name}</span>
              {selectedClass.stereotype && (
                <span className="detail-stereotype">«{selectedClass.stereotype}»</span>
              )}
              <button className="detail-close" onClick={() => {
                setSelectedClass(null);
                cyRef.current?.elements().removeClass('highlighted dimmed focus-source focus-target');
              }}>×</button>
            </div>
            <div className="detail-meta">
              <span className="detail-package">{selectedClass.package || selectedClass.id}</span>
              {selectedClass.businessDomain && (
                <span
                  className="detail-domain-badge"
                  style={{ backgroundColor: getDomainColor(selectedClass.businessDomain) + '30',
                           borderColor: getDomainColor(selectedClass.businessDomain) }}
                >
                  {selectedClass.businessDomain}
                </span>
              )}
            </div>
            {selectedClass.description && (
              <p className="detail-desc">{selectedClass.description}</p>
            )}
            <div className="detail-props-header">
              Properties ({selectedClass.properties.length})
            </div>
            <div className="detail-props">
              {selectedClass.properties.map((p, i) => (
                <div key={i} className="detail-prop">
                  <span className="prop-name">{p.name}</span>
                  <span className="prop-type">{p.type}{p.multiplicity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
