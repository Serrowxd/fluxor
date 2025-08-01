const semver = require('semver');

/**
 * API Versioning Service
 * 
 * Handles API versioning with support for:
 * - Header-based versioning (Accept, X-API-Version)
 * - URL path versioning (/v1/, /v2/)
 * - Query parameter versioning (?version=1.0)
 * - Version deprecation and sunset policies
 * - Version compatibility matrix
 * - Automatic version negotiation
 * 
 * @class ApiVersioning
 */
class ApiVersioning {
  constructor(config = {}) {
    this.config = {
      defaultVersion: '1.0.0',
      supportedVersions: ['1.0.0'],
      deprecationWarnings: true,
      strictVersioning: false,
      versionHeader: 'X-API-Version',
      acceptHeader: 'Accept',
      ...config
    };

    this.versions = new Map();
    this.deprecatedVersions = new Map();
    this.metrics = {
      totalRequests: 0,
      versionUsage: {},
      deprecationWarnings: 0,
      unsupportedVersionRequests: 0
    };

    this.initializeVersions();
  }

  /**
   * Initialize supported versions
   * @private
   */
  initializeVersions() {
    for (const version of this.config.supportedVersions) {
      this.addVersion({
        version,
        status: 'active',
        createdAt: new Date(),
        routes: []
      });
    }
  }

  /**
   * Add a new API version
   * @param {Object} versionConfig - Version configuration
   * @param {string} versionConfig.version - Version string (semver)
   * @param {string} [versionConfig.status] - Version status (active, deprecated, sunset)
   * @param {Date} [versionConfig.deprecatedAt] - Deprecation date
   * @param {Date} [versionConfig.sunsetAt] - Sunset date
   * @param {string} [versionConfig.migrationGuide] - Migration guide URL
   * @param {Object[]} [versionConfig.routes] - Version-specific routes
   * @param {Object} [versionConfig.breaking] - Breaking changes description
   * @returns {string} Version ID
   */
  addVersion(versionConfig) {
    const { version } = versionConfig;
    
    if (!semver.valid(version)) {
      throw new Error(`Invalid version format: ${version}`);
    }

    const versionInfo = {
      version,
      status: versionConfig.status || 'active',
      createdAt: versionConfig.createdAt || new Date(),
      deprecatedAt: versionConfig.deprecatedAt || null,
      sunsetAt: versionConfig.sunsetAt || null,
      migrationGuide: versionConfig.migrationGuide || null,
      routes: versionConfig.routes || [],
      breaking: versionConfig.breaking || {},
      requestCount: 0,
      lastUsed: null,
      compatibility: versionConfig.compatibility || {}
    };

    this.versions.set(version, versionInfo);

    // Initialize metrics tracking
    this.metrics.versionUsage[version] = {
      requests: 0,
      firstUsed: null,
      lastUsed: null,
      uniqueClients: new Set()
    };

    return version;
  }

  /**
   * Extract version from request
   * @param {Object} request - HTTP request object
   * @returns {Object} Version information
   */
  extractVersion(request) {
    const { headers, path, query } = request;
    let version = null;
    let source = null;

    // 1. Custom version header
    if (headers[this.config.versionHeader.toLowerCase()]) {
      version = headers[this.config.versionHeader.toLowerCase()];
      source = 'header';
    }
    
    // 2. Accept header with version parameter
    else if (headers.accept) {
      const acceptMatch = headers.accept.match(/version=([^;,\s]+)/i);
      if (acceptMatch) {
        version = acceptMatch[1];
        source = 'accept-header';
      }
    }
    
    // 3. URL path versioning (/v1/, /v2/, /api/v1.2/)
    else if (path) {
      const pathMatch = path.match(/\/v?(\d+(?:\.\d+(?:\.\d+)?)?)\//);
      if (pathMatch) {
        version = pathMatch[1];
        source = 'path';
        
        // Normalize single digit versions
        if (!version.includes('.')) {
          version = `${version}.0.0`;
        } else if (version.split('.').length === 2) {
          version = `${version}.0`;
        }
      }
    }
    
    // 4. Query parameter versioning
    else if (query && query.version) {
      version = query.version;
      source = 'query';
    }

    // 5. Media type versioning (application/vnd.api+json;v=1)
    else if (headers.accept) {
      const mediaMatch = headers.accept.match(/;v=([^;,\s]+)/i);
      if (mediaMatch) {
        version = mediaMatch[1];
        source = 'media-type';
      }
    }

    return {
      requested: version,
      source,
      resolved: null,
      isDefault: false,
      isDeprecated: false,
      isSunset: false,
      warnings: []
    };
  }

  /**
   * Resolve version using negotiation and compatibility rules
   * @param {Object} versionInfo - Version info from extractVersion
   * @param {Object} [context] - Request context
   * @returns {Object} Resolved version information
   */
  resolveVersion(versionInfo, context = {}) {
    let { requested } = versionInfo;
    const warnings = [];

    // Use default version if none requested
    if (!requested) {
      requested = this.config.defaultVersion;
      versionInfo.isDefault = true;
    }

    // Normalize version format
    requested = this.normalizeVersion(requested);

    // Check if exact version exists
    if (this.versions.has(requested)) {
      const version = this.versions.get(requested);
      
      // Check if version is sunset
      if (version.sunsetAt && new Date() > version.sunsetAt) {
        if (this.config.strictVersioning) {
          throw new Error(`API version ${requested} has been sunset`);
        }
        
        warnings.push({
          type: 'sunset',
          message: `API version ${requested} has been sunset`,
          sunsetAt: version.sunsetAt,
          migrationGuide: version.migrationGuide
        });

        versionInfo.isSunset = true;
      }
      
      // Check if version is deprecated
      else if (version.deprecatedAt && new Date() > version.deprecatedAt) {
        warnings.push({
          type: 'deprecation',
          message: `API version ${requested} is deprecated`,
          deprecatedAt: version.deprecatedAt,
          sunsetAt: version.sunsetAt,
          migrationGuide: version.migrationGuide
        });

        versionInfo.isDeprecated = true;
      }

      versionInfo.resolved = requested;
      versionInfo.warnings = warnings;
      return versionInfo;
    }

    // Try version negotiation
    const negotiated = this.negotiateVersion(requested, context);
    if (negotiated) {
      warnings.push({
        type: 'negotiation',
        message: `Requested version ${requested} not found, using ${negotiated}`,
        requested,
        resolved: negotiated
      });

      versionInfo.resolved = negotiated;
      versionInfo.warnings = warnings;
      return versionInfo;
    }

    // Version not found and negotiation failed
    if (this.config.strictVersioning) {
      throw new Error(`Unsupported API version: ${requested}`);
    }

    // Fall back to default version
    warnings.push({
      type: 'fallback',
      message: `Unsupported version ${requested}, falling back to ${this.config.defaultVersion}`,
      requested,
      resolved: this.config.defaultVersion
    });

    versionInfo.resolved = this.config.defaultVersion;
    versionInfo.warnings = warnings;
    return versionInfo;
  }

  /**
   * Negotiate best compatible version
   * @param {string} requestedVersion - Requested version
   * @param {Object} context - Request context
   * @returns {string|null} Best compatible version
   */
  negotiateVersion(requestedVersion, context = {}) {
    const supported = Array.from(this.versions.keys())
      .filter(v => {
        const versionInfo = this.versions.get(v);
        return versionInfo.status === 'active' || versionInfo.status === 'deprecated';
      })
      .sort((a, b) => semver.rcompare(a, b)); // Sort by version descending

    // 1. Try exact match first
    if (supported.includes(requestedVersion)) {
      return requestedVersion;
    }

    // 2. Try satisfies range (e.g., ~1.0.0, ^1.0.0)
    try {
      const range = requestedVersion;
      const satisfying = supported.filter(v => semver.satisfies(v, range));
      if (satisfying.length > 0) {
        return satisfying[0]; // Return highest satisfying version
      }
    } catch (error) {
      // Invalid range, continue with other strategies
    }

    // 3. Try major version compatibility
    const requestedMajor = semver.major(requestedVersion);
    const majorCompatible = supported.filter(v => semver.major(v) === requestedMajor);
    if (majorCompatible.length > 0) {
      return majorCompatible[0]; // Return highest compatible in same major version
    }

    // 4. Try custom compatibility rules
    for (const [version, info] of this.versions) {
      if (info.compatibility && info.compatibility[requestedVersion]) {
        return version;
      }
    }

    // 5. Fall back to latest stable version
    return supported[0] || null;
  }

  /**
   * Normalize version string to semver format
   * @param {string} version - Version string
   * @returns {string} Normalized version
   */
  normalizeVersion(version) {
    if (!version) return this.config.defaultVersion;

    // Handle simple integer versions (1 -> 1.0.0)
    if (/^\d+$/.test(version)) {
      return `${version}.0.0`;
    }

    // Handle major.minor versions (1.2 -> 1.2.0)
    if (/^\d+\.\d+$/.test(version)) {
      return `${version}.0`;
    }

    // Return as-is if already valid semver
    if (semver.valid(version)) {
      return version;
    }

    // Try to coerce invalid versions
    const coerced = semver.coerce(version);
    return coerced ? coerced.version : this.config.defaultVersion;
  }

  /**
   * Deprecate a version
   * @param {string} version - Version to deprecate
   * @param {Object} options - Deprecation options
   */
  deprecateVersion(version, options = {}) {
    const versionInfo = this.versions.get(version);
    if (!versionInfo) {
      throw new Error(`Version not found: ${version}`);
    }

    versionInfo.status = 'deprecated';
    versionInfo.deprecatedAt = options.deprecatedAt || new Date();
    versionInfo.sunsetAt = options.sunsetAt || null;
    versionInfo.migrationGuide = options.migrationGuide || null;

    this.deprecatedVersions.set(version, versionInfo);
  }

  /**
   * Sunset a version (permanently disable)
   * @param {string} version - Version to sunset
   * @param {Object} options - Sunset options
   */
  sunsetVersion(version, options = {}) {
    const versionInfo = this.versions.get(version);
    if (!versionInfo) {
      throw new Error(`Version not found: ${version}`);
    }

    versionInfo.status = 'sunset';
    versionInfo.sunsetAt = options.sunsetAt || new Date();
    versionInfo.migrationGuide = options.migrationGuide || null;
  }

  /**
   * Track version usage for metrics
   * @param {string} version - Version used
   * @param {Object} request - Request object
   */
  trackUsage(version, request) {
    this.metrics.totalRequests++;

    const versionInfo = this.versions.get(version);
    if (versionInfo) {
      versionInfo.requestCount++;
      versionInfo.lastUsed = new Date();
    }

    const usage = this.metrics.versionUsage[version];
    if (usage) {
      usage.requests++;
      usage.lastUsed = new Date();
      
      if (!usage.firstUsed) {
        usage.firstUsed = new Date();
      }

      // Track unique clients (simplified using IP)
      const clientId = request.ip || request.headers['x-forwarded-for'] || 'unknown';
      usage.uniqueClients.add(clientId);
    }

    // Track deprecated version usage
    if (versionInfo && versionInfo.status === 'deprecated') {
      this.metrics.deprecationWarnings++;
    }
  }

  /**
   * Get version information
   * @param {string} version - Version to get info for
   * @returns {Object|null} Version information
   */
  getVersionInfo(version) {
    return this.versions.get(version) || null;
  }

  /**
   * Get all versions
   * @param {Object} filters - Filter options
   * @returns {Array} Array of version information
   */
  getAllVersions(filters = {}) {
    let versions = Array.from(this.versions.values());

    if (filters.status) {
      versions = versions.filter(v => v.status === filters.status);
    }

    if (filters.active) {
      versions = versions.filter(v => v.status === 'active');
    }

    if (filters.deprecated) {
      versions = versions.filter(v => v.status === 'deprecated');
    }

    return versions.sort((a, b) => semver.rcompare(a.version, b.version));
  }

  /**
   * Check if version is supported
   * @param {string} version - Version to check
   * @returns {boolean} True if supported
   */
  isSupported(version) {
    const normalized = this.normalizeVersion(version);
    const versionInfo = this.versions.get(normalized);
    
    if (!versionInfo) return false;
    
    // Check if sunset
    if (versionInfo.sunsetAt && new Date() > versionInfo.sunsetAt) {
      return false;
    }
    
    return versionInfo.status === 'active' || versionInfo.status === 'deprecated';
  }

  /**
   * Generate version headers for response
   * @param {string} version - Current version
   * @param {Array} warnings - Version warnings
   * @returns {Object} Headers object
   */
  generateResponseHeaders(version, warnings = []) {
    const headers = {};

    // Current version header
    headers[this.config.versionHeader] = version;

    // Supported versions
    const supportedVersions = this.getAllVersions({ active: true })
      .map(v => v.version)
      .join(', ');
    headers['X-Supported-Versions'] = supportedVersions;

    // Deprecation warnings
    const deprecationWarnings = warnings.filter(w => 
      w.type === 'deprecation' || w.type === 'sunset'
    );

    if (deprecationWarnings.length > 0) {
      const warning = deprecationWarnings[0];
      headers['Warning'] = `299 - "${warning.message}"`;
      
      if (warning.sunsetAt) {
        headers['Sunset'] = warning.sunsetAt.toISOString();
      }
      
      if (warning.migrationGuide) {
        headers['Link'] = `<${warning.migrationGuide}>; rel="successor-version"`;
      }
    }

    return headers;
  }

  /**
   * Get usage metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    const processedMetrics = {
      ...this.metrics,
      versionUsage: {}
    };

    // Process usage metrics to remove Set objects
    for (const [version, usage] of Object.entries(this.metrics.versionUsage)) {
      processedMetrics.versionUsage[version] = {
        ...usage,
        uniqueClients: usage.uniqueClients.size
      };
    }

    return processedMetrics;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      versionUsage: {},
      deprecationWarnings: 0,
      unsupportedVersionRequests: 0
    };

    // Reinitialize version usage tracking
    for (const version of this.versions.keys()) {
      this.metrics.versionUsage[version] = {
        requests: 0,
        firstUsed: null,
        lastUsed: null,
        uniqueClients: new Set()
      };
    }
  }

  /**
   * Export version configuration
   * @returns {Object} Configuration export
   */
  exportConfiguration() {
    return {
      config: this.config,
      versions: Array.from(this.versions.entries()),
      deprecatedVersions: Array.from(this.deprecatedVersions.entries()),
      exportedAt: new Date()
    };
  }

  /**
   * Import version configuration
   * @param {Object} data - Configuration data
   */
  importConfiguration(data) {
    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }

    if (data.versions) {
      this.versions.clear();
      for (const [version, info] of data.versions) {
        this.versions.set(version, info);
      }
    }

    if (data.deprecatedVersions) {
      this.deprecatedVersions.clear();
      for (const [version, info] of data.deprecatedVersions) {
        this.deprecatedVersions.set(version, info);
      }
    }

    // Reinitialize metrics
    this.resetMetrics();
  }
}

module.exports = ApiVersioning;