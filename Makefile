#
# Copyright (C) 2008-2014 The LuCI Team <luci@lists.subsignal.org>
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wolh
LUCI_TITLE:=LuCI Support for Wake-on-LAN
LUCI_DEPENDS:=+luci-base +etherwake

PKG_VERSION:=0.1
PKG_RELEASE:=1

LUCI_PKGARCH:=all
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=huggy <wolh@huggy.moe> (This fork), Jo-Philipp Wich <jo@mein.io>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature