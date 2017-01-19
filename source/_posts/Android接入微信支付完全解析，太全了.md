---
title: Android接入微信支付完全解析，太全了~
date: 2016-4-15 15:25:07
categories: Android
tags: 
    - Android
    - 微信支付
---
今天来聊聊，android中接入微信支付的需求，肯定有人会说，这多简单呀，还在这里扯什么，赶快去洗洗睡吧~~

那我就不服了，要是说这简单的，你知道微信支付官网多少吗，要是你一百度，下面全是广告，哈哈，你一不小心就掉坑去了，在简单的事，只要你想把他做好，其实也是很复杂的~

## 简介

首先我们来到[微信支付官网](https://pay.weixin.qq.com/index.php)瞅瞅：

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/1.png)

可以看到这就是微信支付首页，下面有几种支付方式，而我们今天的主角就是APP支付，我们可以直接点进去，或者从左上角接入指引-APP支付，进去的文档式样的，[这是这个文档的位置](http://kf.qq.com/faq/120911VrYVrA150906F3qqY3.html)如下图所示：

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/2.png)

肯定有人说，你贴这么有毛用呀，还浪费我流量...

别急让我给你说说这图有什么用，首先从这图你能看出从注册开发平台账号到完成支付接入需要哪些步骤，哪些资料，这样你可以让相关的人员事先去准备这些资料，而不是填完一步资料，在去找下一步资料，记住时间就是金钱，另外你领导说来给我讲讲微信支付那准备哪些资料，你没看过这文档，那我就只能呵呵了O(∩_∩)O~。另外哪些说支付简单的，有几个知道这张图，又有谁认真看过~~

可以看到是要加300块的，还需要企业的一些资料。

另外微信支付有两个平台分别是[开发者平台](https://open.weixin.qq.com/)和[商户平台](https://pay.weixin.qq.com)

开发者平台：主要是针对开发者，比如：创建应用，获取appid
商户平台：主要是商户上面的一些管理，比如：可以查看流水，订单呀

## 创建应用

这里我只是演示怎么创建应用，最后不会用这个账号的，因为我这是个人账号，没法申请支付，只是给不会创建的朋友做一个演示，需要哪些资料而已，会的可略过~

首先我们来到[开发者平台](https://open.weixin.qq.com/)，没有账号的先注册，这个我想不用演示了，直接演示怎么创建应用，首先你的登录完账号，点击管理中心-移动应用：

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/3.png)

点击左上角的创建移动应用，到如下界面，因为这里是测试，所有资料都是随便填啦

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/4.png)

点击下一步就来到了

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/5.png)

这一步让你填写，需要的平台，以及平台信息，我这里只悬着android，填入包名和签名，另外这里他没有想微博那样可以填入多个签名，那么这里我建议你一开始填入debug的签名，等调试通过了在填写正式签名，签名的获取方法和接入第三方登录是一样的。最后提交审核，等审核完以后，我们点击到应用详情，应该是这样的效果

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/6.png)

个人账号创建的应用审核通过后只有，分享功能，如果还需要支付，可以点击申请，然后认证账号并上传一些资料，这又是一个漫长的过程，这里我们就不了那么多了，现在直接说怎么在代码实现吧

## 运行官方demo

记住这里的支付demo是在商户平台的帮助里面下载，[地址在这里](https://pay.weixin.qq.com/wiki/doc/api/app/app.php?chapter=11_1)，而不是开发者平台下载的那个demo（以前是可以，现在这里下载的demo，里面剔除了支付），如下图，是这个页面：

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/7.png)

第一个是基础库，点击后会跳到开发者平台，第二个参数支付demo，当然里面也包含了分享等一些功能，可以说如果你既要做支付又要做分享，那么你只需要这个一个demo就行了，当然还得需要我这篇文章呀

下载完导入eclipse，替换debug.keystore然后运行，就可以看到如下界面，终于看到支付了，激动不已是不是

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/8.png)

然后我们就可以点击“跳转到支付界面”，看看什么效果呀，是骡子是马总的溜溜吧，看到这一面，感觉神清气爽，因为demo跑通了，呵呵~

![Paste_Image.png](http://7qnc6h.com1.z0.glb.clouddn.com/9.png)

demo也看了，钱也付了，那我们现在就该开始接入支付了

## 正式接入支付

首先还是得上一张流程图呀，不然你知道怎么个逻辑？

这是这个文档的[官方地址](https://pay.weixin.qq.com/wiki/doc/api/app/app.php?chapter=8_3)

![](https://pay.weixin.qq.com/wiki/doc/api/img/chapter8_3_1.png)，这是官方的解释

> 商户系统和微信支付系统主要交互说明：

> 步骤1：用户在商户APP中选择商品，提交订单，选择微信支付。

> 步骤2：商户后台收到用户支付单，调用微信支付统一下单接口。参见【统一下单API】。

> 步骤3：统一下单接口返回正常的prepay_id，再按签名规范重新生成签名后，将数据传输给APP。参与签名的字段名为appId，partnerId，prepayId，nonceStr，timeStamp，package。注意：package的值格式为Sign=WXPay 

> 步骤4：商户APP调起微信支付。api参见本章节【app端开发步骤说明】

> 步骤5：商户后台接收支付通知。api参见【支付结果通知API】

> 步骤6：商户后台查询支付结果。，api参见【查询订单API】

首要微信支付暴露给我的是两步，一步是生成预支付订单，然后那个预支付订单id再去调用微信支付，所以说这里就有两种实现方式了，一种是客户端处理这所有步骤，另外一种肯定是服务端创建与支付订单和签名，然后返回给我们，我们才拿着这些参数去调用微信支付。实际应用中，推荐使用服务那种，但是我这里讲的是本地怎么实现支付，如果你们是在服务端支付，那么你的告诉他你需要什么参数，他怎么创建预支付订单等[服务端下单参考这里](https://pay.weixin.qq.com/wiki/doc/api/app/app.php?chapter=9_1)

### 配置

这是[官方的app支付开发步骤](https://pay.weixin.qq.com/wiki/doc/api/app/app.php?chapter=8_5)，另外这里由于我没有可用的支付所以，写demo我用的包名和key都是微信demo的

配置权限

配置activity

```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

配置回调activity
```xml
<activity
    android:name=".wxapi.WXPayEntryActivity"
    android:exported="true"
    android:launchMode="singleTop"/>
```

调用支付

```java
public void testWxPay(View view) {
    new Thread(new Runnable() {
        @Override
        public void run() {
            String url = "http://wxpay.weixin.qq.com/pub_v2/app/app_pay.php?plat=android";
            ToastUtil.shortToastInBackgroundThread(getActivity(), "获取订单中...");
            try {
                byte[] buf = Util.httpGet(url);
                if (buf != null && buf.length > 0) {
                    String content = new String(buf);
                    Log.e("get server pay params:", content);
                    JSONObject json = new JSONObject(content);
                    if (null != json && !json.has("retcode")) {
                        req = new PayReq();
                        //req.appId = "wxf8b4f85f3a794e77";  // 测试用appId
                        req.appId = json.getString("appid");
                        req.partnerId = json.getString("partnerid");
                        req.prepayId = json.getString("prepayid");
                        req.nonceStr = json.getString("noncestr");
                        req.timeStamp = json.getString("timestamp");
                        req.packageValue = json.getString("package");
                        req.sign = json.getString("sign");
                        req.extData = "app data"; // optional
                        ToastUtil.shortToastInBackgroundThread(getActivity(), "正常调起支付");
                        toPay();
                    } else {
                        Log.d("PAY_GET", "返回错误" + json.getString("retmsg"));
                        ToastUtil.shortToastInBackgroundThread(getActivity(), "返回错误" + json.getString("retmsg"));
                    }
                } else {
                    Log.d("PAY_GET", "服务器请求错误");
                    ToastUtil.shortToastInBackgroundThread(getActivity(), "服务器请求错误");
                }
            } catch (Exception e) {
                Log.e("PAY_GET", "异常：" + e.getMessage());
                ToastUtil.shortToastInBackgroundThread(getActivity(), "异常：" + e.getMessage());
            }
        }
    }).start();

}

private void toPay() {
    // 在支付之前，如果应用没有注册到微信，应该先调用IWXMsg.registerApp将应用注册到微信
    api.sendReq(req);
}
```

到这里如果你按照我的配置的话，正常情况下试可用调起支付界面了，如果出现-1，请检查是不是替换了debug.keystore，如果替换了，还是这样记得清空微信缓存

以上测试代码都在[github](https://github.com/lifengsofts/TestThirdPartyFunction)上，官方的下载的sdk包也在该仓库的docs目录下

如果我的文章对来带来的帮助，可加我微信，微博，QQ什么啥的交个朋友也是不错的，另外微信，微博都会不定期发一些优质的文章，感谢大家的支持~~，联系方式在我的个人介绍里啦