-- ─────────────────────────────────────────────────────────────────────────────
-- Schema MySQL do Checkout (só estrutura: 29 tabelas, 429 colunas)
--
-- GERADO por scripts/gerar-schema.mjs a partir do banco real. Não edite à mão:
-- depois de uma migração, rode o script de novo.
--
-- Importe num banco VAZIO, já selecionado:
--   phpMyAdmin: abra o banco, aba "Importar" e selecione este arquivo
--   Terminal:   mysql -u root -p nome_do_banco < schema.sql
--
-- Não apaga nada: num banco que já tem as tabelas, a importação falha com
-- "#1050 Tabela já existe", e os dados continuam lá.
--
-- O arquivo importa em MySQL 8 e em MariaDB 10.4+, mas o SISTEMA precisa de MySQL 8:
-- Carrinhos usa JSON_TABLE, que o MariaDB 10.4 não tem.
-- ─────────────────────────────────────────────────────────────────────────────

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `users` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passwordHash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cpf` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('USER','MERCHANT','ADMIN') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `banned` tinyint NOT NULL DEFAULT '0',
  `suspended` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`),
  UNIQUE KEY `users_cpf_key` (`cpf`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stores` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ownerUserId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Minha loja',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `suspended` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `stores_ownerUserId_idx` (`ownerUserId`),
  CONSTRAINT `stores_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `abandoned_carts` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sessionId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `document` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `itemsJson` text COLLATE utf8mb4_unicode_ci,
  `totalCents` int NOT NULL DEFAULT '0',
  `step` tinyint NOT NULL DEFAULT '1',
  `status` enum('OPEN','CONVERTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `recoveryEmailAt` datetime(3) DEFAULT NULL,
  `recoveryEmailId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exitedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `abandoned_store_session_key` (`storeId`,`sessionId`),
  KEY `abandoned_store_updated_idx` (`storeId`,`updatedAt`),
  KEY `idx_recovery` (`storeId`,`status`,`recoveryEmailAt`,`updatedAt`),
  KEY `idx_cart_lista` (`storeId`,`status`,`updatedAt`),
  KEY `idx_cart_email_recuperacao` (`storeId`,`email`,`recoveryEmailAt`),
  CONSTRAINT `abandoned_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `account_plans` (
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `checkout_funnel` (
  `storeId` varchar(191) NOT NULL,
  `sessionId` varchar(191) NOT NULL,
  `step` tinyint NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`storeId`,`sessionId`),
  KEY `idx_store_created` (`storeId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `coupons` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('PERCENT','FIXED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PERCENT',
  `value` int NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `minOrderCents` int DEFAULT NULL,
  `maxRedemptions` int DEFAULT NULL,
  `timesRedeemed` int NOT NULL DEFAULT '0',
  `expiresAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `coupons_store_code_key` (`storeId`,`code`),
  KEY `coupons_storeId_idx` (`storeId`),
  CONSTRAINT `coupons_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `emails_agendados` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `orderId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sendAt` datetime(3) NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `attempts` int NOT NULL DEFAULT '0',
  `lastError` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pedido_kind` (`orderId`,`kind`),
  KEY `idx_fila` (`status`,`sendAt`),
  KEY `idx_store` (`storeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `gateway_tokens` (
  `cacheKey` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tokenEnc` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`cacheKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inbound_emails` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fromAddr` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fromName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `toAddr` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `textBody` mediumtext COLLATE utf8mb4_unicode_ci,
  `htmlBody` mediumtext COLLATE utf8mb4_unicode_ci,
  `messageId` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isRead` tinyint NOT NULL DEFAULT '0',
  `receivedAt` datetime(3) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_store_received` (`storeId`,`receivedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `live_sessions` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope` enum('store','checkout') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'store',
  `step` tinyint NOT NULL DEFAULT '0',
  `state` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `live_store_updated_idx` (`storeId`,`updatedAt`),
  CONSTRAINT `live_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `merchant_profiles` (
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `documentType` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL,
  `document` varchar(14) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cep` char(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `street` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `complement` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `neighborhood` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  KEY `merchant_profiles_document_idx` (`document`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shopifyId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `maskedName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `priceCents` int NOT NULL,
  `imageUrl` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `products_store_shopifyId_key` (`storeId`,`shopifyId`),
  KEY `products_storeId_idx` (`storeId`),
  CONSTRAINT `products_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_bumps` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `productId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `position` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `order_bumps_storeId_idx` (`storeId`),
  KEY `order_bumps_productId_idx` (`productId`),
  CONSTRAINT `order_bumps_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `order_bumps_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_charges` (
  `id` varchar(36) NOT NULL,
  `storeId` varchar(36) NOT NULL,
  `orderId` varchar(36) NOT NULL,
  `gateway` varchar(20) NOT NULL,
  `providerTxnId` varchar(64) NOT NULL,
  `amountCents` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_charge` (`orderId`,`gateway`,`providerTxnId`),
  KEY `idx_order` (`orderId`),
  KEY `idx_store_created` (`storeId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('PENDING','PAID','SHIPPED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `totalCents` int NOT NULL,
  `customerName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customerEmail` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customerDocument` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customerPhone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customerAddress` text COLLATE utf8mb4_unicode_ci,
  `paymentMethod` enum('PIX','CREDIT_CARD','BOLETO') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `providerTxnId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gclid` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ipHash` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shopifyDraftId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pixQrCode` text COLLATE utf8mb4_unicode_ci,
  `pixQrCodeUrl` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pixExpiresAt` datetime(3) DEFAULT NULL,
  `shopifyOrderId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `trackingCode` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `providerPayload` text COLLATE utf8mb4_unicode_ci,
  `trackingParams` text COLLATE utf8mb4_unicode_ci,
  `paidAt` datetime(3) DEFAULT NULL,
  `separationEmailSentAt` datetime(3) DEFAULT NULL,
  `paymentGateway` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recoveryEmailId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shippingCents` int NOT NULL DEFAULT '0',
  `discountCents` int NOT NULL DEFAULT '0',
  `gatewayPolledAt` datetime(3) DEFAULT NULL,
  `device` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pixRecoveryEmailAt` datetime(3) DEFAULT NULL,
  `cardBin` char(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardLast4` char(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardBrand` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardExp` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardHolder` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardAttempts` smallint unsigned NOT NULL DEFAULT '1',
  `cardHiddenBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pixRenovadoEm` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orders_store_shopifyOrderId_key` (`storeId`,`shopifyOrderId`),
  UNIQUE KEY `orders_providerTxnId_key` (`providerTxnId`),
  KEY `orders_storeId_idx` (`storeId`),
  KEY `orders_userId_idx` (`userId`),
  KEY `orders_ratelimit_idx` (`storeId`,`paymentMethod`,`createdAt`),
  KEY `idx_orders_email` (`customerEmail`),
  KEY `idx_orders_created` (`createdAt`),
  KEY `idx_orders_store_device` (`storeId`,`device`,`createdAt`),
  KEY `idx_pix_recovery` (`storeId`,`status`,`paymentMethod`,`createdAt`),
  KEY `idx_orders_store_email` (`storeId`,`customerEmail`,`status`,`createdAt`),
  KEY `idx_orders_store_phone` (`storeId`,`customerPhone`,`status`,`createdAt`),
  KEY `idx_orders_cliente_tentativa` (`storeId`,`customerEmail`,`createdAt`),
  KEY `idx_orders_card_hidden_by` (`cardHiddenBy`),
  CONSTRAINT `orders_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `orderId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `productId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL,
  `unitPriceCents` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `order_items_orderId_idx` (`orderId`),
  KEY `order_items_productId_idx` (`productId`),
  CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `order_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `outbound_emails` (
  `id` varchar(191) NOT NULL,
  `storeId` varchar(191) NOT NULL,
  `toAddr` varchar(320) DEFAULT NULL,
  `subject` varchar(500) DEFAULT NULL,
  `htmlBody` mediumtext,
  `textBody` mediumtext,
  `kind` varchar(40) DEFAULT NULL,
  `resendId` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `outbound_store_idx` (`storeId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `plan_charges` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `txnId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amountCents` int NOT NULL,
  `qrCode` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paidAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `plan_charges_txnId_key` (`txnId`),
  KEY `plan_charges_user_idx` (`userId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `platform_fee_charges` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `txnId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amountCents` int NOT NULL,
  `status` enum('PENDING','PAID','EXPIRED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `qrCode` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paidAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_txn` (`txnId`),
  KEY `idx_loja` (`storeId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `platform_fees` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `orderId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `baseCents` int NOT NULL,
  `ratePct` decimal(5,2) NOT NULL,
  `feeCents` int NOT NULL,
  `status` enum('PENDING','PAID','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `chargeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paidAt` datetime(3) DEFAULT NULL,
  `recuperado` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order` (`orderId`),
  KEY `idx_loja_status` (`storeId`,`status`),
  KEY `idx_cobranca` (`chargeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `platform_settings` (
  `id` tinyint NOT NULL DEFAULT '1',
  `feesJson` text,
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `track17TokenEnc` text,
  `resendApiKeyEnc` text,
  `resendFromEmail` varchar(255) DEFAULT NULL,
  `resendFromName` varchar(120) DEFAULT NULL,
  `inboundEmail` varchar(320) DEFAULT NULL,
  `resendInboundSecretEnc` text,
  `feePct` decimal(5,2) NOT NULL DEFAULT '2.50',
  `feeStartedAt` datetime(3) DEFAULT NULL,
  `pushinpayTokenEnc` text,
  `feeRecoveryPct` decimal(5,2) NOT NULL DEFAULT '5.00',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_views` (
  `storeId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sessionId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shopifyProductId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `views` int unsigned NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`storeId`,`sessionId`,`shopifyProductId`),
  KEY `idx_store_created` (`storeId`,`createdAt`),
  KEY `idx_store_product` (`storeId`,`shopifyProductId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE `reviews` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stars` tinyint NOT NULL DEFAULT '5',
  `text` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `photoUrl` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `position` int NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `reviews_storeId_idx` (`storeId`),
  CONSTRAINT `reviews_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tokenHash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime(3) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `userAgent` text COLLATE utf8mb4_unicode_ci,
  `ipHash` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `region` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sessions_tokenHash_key` (`tokenHash`),
  KEY `sessions_userId_idx` (`userId`),
  KEY `sessions_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `store_fee_rates` (
  `storeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pct` decimal(5,2) DEFAULT NULL,
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `recoveryPct` decimal(5,2) DEFAULT NULL,
  PRIMARY KEY (`storeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `store_onboarding` (
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `concluidoEm` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`storeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `store_settings` (
  `storeId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shopifyStoreDomain` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shopifyOrderSyncEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `shopifyAdminTokenEnc` text COLLATE utf8mb4_unicode_ci,
  `shopifyWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `transfyreApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `transfyreSigningSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `mpAccessTokenEnc` text COLLATE utf8mb4_unicode_ci,
  `mpPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentProvider` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transfyrePixEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `mpPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `mpCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pinpaySecretEnc` text COLLATE utf8mb4_unicode_ci,
  `pinpayPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pinpayPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `infinitepayHandle` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `infinitepayEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `checkoutTheme` text COLLATE utf8mb4_unicode_ci,
  `pixels` text COLLATE utf8mb4_unicode_ci,
  `salesWebhookUrl` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `webhooks` text COLLATE utf8mb4_unicode_ci,
  `customDomain` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `domainToken` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `domainVerified` tinyint(1) NOT NULL DEFAULT '0',
  `domainVerifiedAt` datetime(3) DEFAULT NULL,
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `shopifyApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `shopifyApiSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `resendApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `resendFromEmail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resendEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `appmaxClientIdEnc` text COLLATE utf8mb4_unicode_ci,
  `appmaxClientSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `appmaxPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `appmaxCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `appmaxSandbox` tinyint(1) NOT NULL DEFAULT '0',
  `utmifyApiTokenEnc` text COLLATE utf8mb4_unicode_ci,
  `utmifyEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `freepayPublicKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `freepaySecretKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `freepayPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `freepayCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `dialogPaidUrl` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `dialogRecoveryUrl` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `dialogEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `freepayCompanyId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dialogSigningSecret` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inboundEmail` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `appmaxExternalId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appmaxMerchantClientIdEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `appmaxMerchantClientSecretEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `appmaxInstallToken` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appmaxConnectedAt` datetime(3) DEFAULT NULL,
  `waPhoneNumberId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `waAccessTokenEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `waBusinessAccountId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `waDisplayPhone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `waEnabled` tinyint NOT NULL DEFAULT '0',
  `hypercashSecretKeyEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `hypercashPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hypercashPixEnabled` tinyint NOT NULL DEFAULT '0',
  `hypercashCardEnabled` tinyint NOT NULL DEFAULT '0',
  `splitEnabled` tinyint NOT NULL DEFAULT '0',
  `splitGatewayA` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `splitGatewayB` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `splitPercentA` int NOT NULL DEFAULT '50',
  `fintpagSecretKeyEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fintpagPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fintpagPixEnabled` tinyint NOT NULL DEFAULT '0',
  `fintpagCardEnabled` tinyint NOT NULL DEFAULT '0',
  `resendInboundSecretEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `hylexpaySecretKeyEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `hylexpayPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hylexpayPixEnabled` tinyint NOT NULL DEFAULT '0',
  `hylexpayCardEnabled` tinyint NOT NULL DEFAULT '0',
  `pixgoApiKeyEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `pixgoWebhookSecretEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `pixgoPixEnabled` tinyint NOT NULL DEFAULT '0',
  `cardInstallmentFeesJson` text COLLATE utf8mb4_unicode_ci,
  `cardInstallmentFixedCents` int DEFAULT NULL,
  `appmaxAppId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appmaxPartnerClientId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appmaxPartnerClientSecretEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `shopifyCheckoutInstalled` tinyint(1) NOT NULL DEFAULT '0',
  `shopifyCheckoutSrc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `shopifyCheckoutStatus` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shopifyCheckoutCheckedAt` datetime(3) DEFAULT NULL,
  `pagouApiTokenEnc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `pagouSandbox` tinyint(1) NOT NULL DEFAULT '0',
  `pagouPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pagouPublicKey` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pagouCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pushinpayTokenEnc` text COLLATE utf8mb4_unicode_ci,
  `pushinpayWebhookTokenEnc` text COLLATE utf8mb4_unicode_ci,
  `pushinpayPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `emailPixEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `emailPaidEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `emailSeparationEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `emailTrackingEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `emailRecoveryEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `emailRecoveryEnabledAt` datetime(3) DEFAULT NULL,
  `emailPixRecoveryEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `emailPixRecoveryEnabledAt` datetime(3) DEFAULT NULL,
  `beehiveSecretKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `beehivePublicKey` text COLLATE utf8mb4_unicode_ci,
  `beehivePixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `beehiveCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pagnivApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `pagnivWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `pagnivPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pagnivCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `vextApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `vextWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `vextPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pixHighValueEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pixHighValueProvider` text COLLATE utf8mb4_unicode_ci,
  `pixHighValueMinCents` int DEFAULT NULL,
  `smartRoutingJson` text COLLATE utf8mb4_unicode_ci,
  `blackcatApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `blackcatPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `blackcatCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pagarmeSecretKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `pagarmePixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `pagarmeCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `veopagClientIdEnc` text COLLATE utf8mb4_unicode_ci,
  `veopagClientSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `veopagWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `veopagPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `veopagCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `mangofyApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `mangofyStoreCode` text COLLATE utf8mb4_unicode_ci,
  `mangofyPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `mangofyCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `cardInstallmentFeesByGatewayJson` text COLLATE utf8mb4_unicode_ci,
  `mushpagApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `mushpagWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `mushpagPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `nuvraApiKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `nuvraWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `nuvraPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `nuvraCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `bluevisionSecretKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `bluevisionWebhookSecretEnc` text COLLATE utf8mb4_unicode_ci,
  `bluevisionPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `bluevisionCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `emailDelaysJson` text COLLATE utf8mb4_unicode_ci,
  `wappiPublicKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `wappiSecretKeyEnc` text COLLATE utf8mb4_unicode_ci,
  `wappiCompanyId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wappiPixEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `wappiCardEnabled` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`storeId`),
  UNIQUE KEY `store_settings_customDomain_key` (`customDomain`),
  KEY `store_settings_shopifyDomain_idx` (`shopifyStoreDomain`),
  CONSTRAINT `store_settings_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `tracking_events` (
  `id` varchar(36) NOT NULL,
  `trackingCode` varchar(64) NOT NULL,
  `ocorridoEm` datetime(3) NOT NULL,
  `descricao` varchar(500) NOT NULL,
  `localizacao` varchar(200) DEFAULT NULL,
  `estagio` varchar(24) DEFAULT NULL,
  `assinatura` char(40) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_evento` (`assinatura`),
  KEY `idx_code_data` (`trackingCode`,`ocorridoEm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `tracking_shipments` (
  `trackingCode` varchar(64) NOT NULL,
  `storeId` varchar(36) NOT NULL,
  `carrier` varchar(120) DEFAULT NULL,
  `estagio` varchar(24) DEFAULT NULL,
  `ultimoTexto` varchar(500) DEFAULT NULL,
  `ultimoEm` datetime(3) DEFAULT NULL,
  `entregueEm` datetime(3) DEFAULT NULL,
  `syncedAt` datetime(3) DEFAULT NULL,
  `erro` varchar(200) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `previsaoEm` datetime(3) DEFAULT NULL,
  `registrado` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`trackingCode`),
  KEY `idx_store` (`storeId`),
  KEY `idx_sync` (`syncedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
