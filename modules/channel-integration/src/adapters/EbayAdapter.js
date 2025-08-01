const BaseAdapter = require('./BaseAdapter');
const axios = require('axios');

class EbayAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.validateConfig();
    
    this.siteId = config.siteId || 0; // US site
    this.sandbox = config.sandbox || false;
    this.baseUrl = this.sandbox 
      ? 'https://api.sandbox.ebay.com' 
      : 'https://api.ebay.com';
  }

  validateConfig() {
    if (!this.config.appId) {
      throw new Error('App ID is required');
    }
    if (!this.config.certId) {
      throw new Error('Cert ID is required');
    }
    if (!this.config.devId) {
      throw new Error('Dev ID is required');
    }
    if (!this.config.userToken) {
      throw new Error('User token is required');
    }
  }

  async connect() {
    try {
      const userInfo = await this._getUserInfo();
      this.connected = true;
      return userInfo;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async disconnect() {
    this.connected = false;
  }

  async checkHealth() {
    try {
      const response = await this._makeRequest('GeteBayTime', {});
      
      return {
        status: 'healthy',
        timestamp: response.Timestamp,
        version: response.Version
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: this.normalizeError(error)
      };
    }
  }

  async fetchResources(resource, options = {}) {
    switch (resource) {
      case 'products':
        return await this._fetchListings(options);
      case 'inventory':
        return await this._fetchInventory(options);
      case 'orders':
        return await this._fetchOrders(options);
      default:
        throw new Error(`Unsupported resource: ${resource}`);
    }
  }

  async createResource(resource, data) {
    switch (resource) {
      case 'products':
        return await this._createListing(data);
      default:
        throw new Error(`Create not supported for resource: ${resource}`);
    }
  }

  async updateResource(resource, id, data) {
    switch (resource) {
      case 'products':
        return await this._updateListing(id, data);
      case 'inventory':
        return await this._updateInventory(id, data);
      case 'orders':
        return await this._updateOrder(id, data);
      default:
        throw new Error(`Update not supported for resource: ${resource}`);
    }
  }

  async deleteResource(resource, id) {
    switch (resource) {
      case 'products':
        return await this._endListing(id);
      default:
        throw new Error(`Delete not supported for resource: ${resource}`);
    }
  }

  async setupWebhooks(webhookUrl) {
    const notifications = [
      'ItemSold',
      'ItemRevised',
      'ItemEnded',
      'FixedPriceTransaction',
      'BestOffer'
    ];

    const results = [];

    for (const notification of notifications) {
      try {
        const response = await this._makeRequest('SetNotificationPreferences', {
          ApplicationDeliveryPreferences: {
            ApplicationEnable: 'Enable',
            ApplicationURL: webhookUrl,
            AlertEmail: 'mailto://' + (this.config.alertEmail || 'alerts@example.com'),
            AlertEnable: 'Enable'
          },
          UserDeliveryPreferenceArray: {
            NotificationEnable: [{
              EventType: notification,
              EventEnable: 'Enable'
            }]
          }
        });

        results.push({
          notification,
          status: response.Ack
        });
      } catch (error) {
        console.error(`Failed to setup notification for ${notification}:`, error.message);
      }
    }

    return results;
  }

  async removeWebhooks() {
    try {
      const response = await this._makeRequest('SetNotificationPreferences', {
        ApplicationDeliveryPreferences: {
          ApplicationEnable: 'Disable'
        }
      });

      return [{
        status: response.Ack,
        message: 'All notifications disabled'
      }];
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async _fetchListings(options) {
    const request = {
      EntriesPerPage: options.limit || 100,
      PageNumber: options.page || 1,
      IncludeVariations: true,
      DetailLevel: 'ReturnAll'
    };

    if (options.since) {
      request.StartTimeFrom = options.since.toISOString();
    }

    const response = await this._makeRequest('GetMyeBaySelling', {
      ActiveList: request
    });

    const items = response.ActiveList?.ItemArray?.Item || [];
    
    return items.map(item => ({
      id: item.ItemID,
      sku: item.SKU,
      title: item.Title,
      description: item.Description,
      price: parseFloat(item.BuyItNowPrice || item.StartPrice),
      quantity: parseInt(item.Quantity) - parseInt(item.SellingStatus?.QuantitySold || 0),
      images: item.PictureDetails?.PictureURL ? 
        (Array.isArray(item.PictureDetails.PictureURL) 
          ? item.PictureDetails.PictureURL 
          : [item.PictureDetails.PictureURL]
        ).map(url => ({ url })) : [],
      status: item.SellingStatus?.ListingStatus,
      variations: item.Variations?.Variation?.map(v => ({
        sku: v.SKU,
        price: parseFloat(v.StartPrice),
        quantity: parseInt(v.Quantity) - parseInt(v.SellingStatus?.QuantitySold || 0),
        attributes: v.VariationSpecifics?.NameValueList
      }))
    }));
  }

  async _fetchInventory(options) {
    const listings = await this._fetchListings(options);
    const inventory = [];

    for (const listing of listings) {
      if (listing.variations) {
        for (const variation of listing.variations) {
          inventory.push({
            listingId: listing.id,
            sku: variation.sku || listing.sku,
            quantity: variation.quantity,
            price: variation.price
          });
        }
      } else {
        inventory.push({
          listingId: listing.id,
          sku: listing.sku,
          quantity: listing.quantity,
          price: listing.price
        });
      }
    }

    return inventory;
  }

  async _fetchOrders(options) {
    const request = {
      NumberOfDays: options.days || 30,
      OrderStatus: options.status || 'All',
      EntriesPerPage: options.limit || 100,
      PageNumber: options.page || 1
    };

    if (options.since) {
      request.CreateTimeFrom = options.since.toISOString();
    }

    const response = await this._makeRequest('GetOrders', request);
    const orders = response.OrderArray?.Order || [];

    return orders.map(order => ({
      id: order.OrderID,
      status: order.OrderStatus,
      total: parseFloat(order.Total),
      currency: order.Total._currencyID,
      createdAt: order.CreatedTime,
      buyer: {
        userId: order.BuyerUserID,
        email: order.TransactionArray?.Transaction?.[0]?.Buyer?.Email
      },
      items: order.TransactionArray?.Transaction?.map(t => ({
        itemId: t.Item.ItemID,
        title: t.Item.Title,
        sku: t.Item.SKU,
        quantity: parseInt(t.QuantityPurchased),
        price: parseFloat(t.TransactionPrice)
      })),
      shippingAddress: order.ShippingAddress
    }));
  }

  async _createListing(data) {
    const item = {
      Title: data.title,
      Description: data.description,
      PrimaryCategory: {
        CategoryID: data.categoryId || '1'
      },
      StartPrice: data.price,
      Country: data.country || 'US',
      Currency: data.currency || 'USD',
      DispatchTimeMax: data.dispatchTime || 3,
      ListingDuration: data.duration || 'GTC',
      ListingType: data.listingType || 'FixedPriceItem',
      PaymentMethods: data.paymentMethods || ['PayPal'],
      PostalCode: data.postalCode || '10001',
      Quantity: data.quantity,
      SKU: data.sku,
      ShippingDetails: data.shippingDetails || {
        ShippingType: 'Flat',
        ShippingServiceOptions: {
          ShippingServicePriority: 1,
          ShippingService: 'USPSPriority',
          ShippingServiceCost: '0.00'
        }
      }
    };

    if (data.images && data.images.length > 0) {
      item.PictureDetails = {
        PictureURL: data.images.map(img => img.url)
      };
    }

    const response = await this._makeRequest('AddFixedPriceItem', { Item: item });
    
    return {
      id: response.ItemID,
      ...data
    };
  }

  async _updateListing(id, data) {
    const item = {
      ItemID: id
    };

    if (data.title) item.Title = data.title;
    if (data.description) item.Description = data.description;
    if (data.price) item.StartPrice = data.price;
    if (data.quantity !== undefined) item.Quantity = data.quantity;

    const response = await this._makeRequest('ReviseFixedPriceItem', { Item: item });
    
    return {
      id,
      ...data,
      revised: response.Ack === 'Success'
    };
  }

  async _updateInventory(sku, data) {
    const inventoryStatus = {
      SKU: sku,
      Quantity: data.quantity
    };

    if (data.price) {
      inventoryStatus.StartPrice = data.price;
    }

    const response = await this._makeRequest('ReviseInventoryStatus', {
      InventoryStatus: [inventoryStatus]
    });

    return {
      sku,
      ...data,
      revised: response.Ack === 'Success'
    };
  }

  async _updateOrder(id, data) {
    if (data.status === 'shipped') {
      const response = await this._makeRequest('CompleteSale', {
        OrderID: id,
        Shipped: true,
        Shipment: {
          ShipmentTrackingDetails: {
            ShipmentTrackingNumber: data.trackingNumber,
            ShippingCarrierUsed: data.carrier || 'USPS'
          }
        }
      });

      return {
        id,
        shipped: response.Ack === 'Success'
      };
    }

    throw new Error(`Order status update not supported: ${data.status}`);
  }

  async _endListing(id) {
    const response = await this._makeRequest('EndFixedPriceItem', {
      ItemID: id,
      EndingReason: 'NotAvailable'
    });

    return {
      id,
      ended: response.Ack === 'Success'
    };
  }

  async _getUserInfo() {
    const response = await this._makeRequest('GetUser', {
      DetailLevel: 'ReturnAll'
    });

    return {
      userId: response.User.UserID,
      email: response.User.Email,
      feedbackScore: response.User.FeedbackScore,
      registrationDate: response.User.RegistrationDate,
      site: response.User.Site
    };
  }

  async _makeRequest(callName, data) {
    const headers = {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-DEV-NAME': this.config.devId,
      'X-EBAY-API-APP-NAME': this.config.appId,
      'X-EBAY-API-CERT-NAME': this.config.certId,
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-SITEID': this.siteId.toString(),
      'Content-Type': 'text/xml'
    };

    const xml = this._buildXML(callName, data);

    try {
      const response = await axios.post(
        `${this.baseUrl}/ws/api.dll`,
        xml,
        { headers }
      );

      const result = this._parseXML(response.data);
      
      if (result.Ack === 'Failure') {
        throw new Error(result.Errors?.ShortMessage || 'eBay API error');
      }

      return result;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  _buildXML(callName, data) {
    const credentials = `
      <RequesterCredentials>
        <eBayAuthToken>${this.config.userToken}</eBayAuthToken>
      </RequesterCredentials>
    `;

    const dataXML = this._objectToXML(data);

    return `<?xml version="1.0" encoding="utf-8"?>
      <${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
        ${credentials}
        ${dataXML}
      </${callName}Request>`;
  }

  _objectToXML(obj) {
    let xml = '';
    
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      
      if (Array.isArray(value)) {
        for (const item of value) {
          xml += `<${key}>${
            typeof item === 'object' ? this._objectToXML(item) : item
          }</${key}>`;
        }
      } else if (typeof value === 'object') {
        xml += `<${key}>${this._objectToXML(value)}</${key}>`;
      } else {
        xml += `<${key}>${value}</${key}>`;
      }
    }
    
    return xml;
  }

  _parseXML(xml) {
    // Simple XML parsing - in production use a proper XML parser
    const result = {};
    const matches = xml.matchAll(/<(\w+)>([^<]+)<\/\1>/g);
    
    for (const match of matches) {
      result[match[1]] = match[2];
    }
    
    return result;
  }
}

module.exports = EbayAdapter;